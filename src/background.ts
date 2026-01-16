import type {
	ExtensionMessage,
	ExtensionResponse,
	ErrorObject,
	ResultLocal,
	ResultSync,
	Meeting,
	TranscriptBlock,
	ChatMessage,
	WebhookBody,
	StreamingMessage,
	PortMessage,
} from "./types/index";

const contentPorts: Set<chrome.runtime.Port> = new Set();
const meetingsPagePorts: Set<chrome.runtime.Port> = new Set();

let currentMeetingState: {
	isActive: boolean;
	info: StreamingMessage | null;
	transcript: StreamingMessage[];
} = { isActive: false, info: null, transcript: [] };

chrome.runtime.onConnect.addListener((port) => {
	if (port.name === "transcript-stream") {
		port.onMessage.addListener((msg: PortMessage) => {
			if (msg.type === "subscribe") {
				if (msg.source === "content") {
					contentPorts.add(port);
				} else if (msg.source === "meetings_page") {
					meetingsPagePorts.add(port);
					if (currentMeetingState.isActive) {
						port.postMessage({ type: "meeting_started" });
						if (currentMeetingState.info) {
							port.postMessage(currentMeetingState.info);
						}
						currentMeetingState.transcript.forEach((entry) => port.postMessage(entry));
					}
				}
			}
		});

		port.onDisconnect.addListener(() => {
			contentPorts.delete(port);
			meetingsPagePorts.delete(port);
		});
	}
});

function broadcastToMeetingsPages(message: StreamingMessage): void {
	meetingsPagePorts.forEach((port) => {
		try {
			port.postMessage(message);
		} catch {
			meetingsPagePorts.delete(port);
		}
	});
}

chrome.runtime.onMessage.addListener((msg: StreamingMessage, _sender, _sendResponse) => {
	if (msg.type === "meeting_started") {
		currentMeetingState = { isActive: true, info: null, transcript: [] };
	} else if (msg.type === "meeting_info") {
		currentMeetingState.info = msg;
	} else if (msg.type === "transcript_entry") {
		currentMeetingState.transcript.push(msg);
	} else if (msg.type === "meeting_ended") {
		currentMeetingState = { isActive: false, info: null, transcript: [] };
	}

	if (msg.type === "transcript_entry" || msg.type === "meeting_info" || msg.type === "meeting_started" || msg.type === "meeting_ended") {
		broadcastToMeetingsPages(msg);
	}
	return false;
});

const timeFormat: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hour12: true,
};

chrome.runtime.onMessage.addListener(function (messageUnTyped: unknown, _sender, sendResponse) {
	const message = messageUnTyped as ExtensionMessage;
	console.log(message.type);

	if (message.type === "new_meeting_started") {
		// Saving current tab id, to download transcript when this tab is closed
		chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
			const tabId = tabs[0].id;
			chrome.storage.local.set({ meetingTabId: tabId }, function () {
				console.log("Meeting tab id saved");
			});
		});
	}

	if (message.type === "meeting_ended") {
		// Prevents double downloading of transcript from tab closed event listener. Also prevents available update from being applied, during meeting post processing.
		chrome.storage.local.set({ meetingTabId: "processing" }, function () {
			console.log("Meeting tab id set to processing meeting");

			processLastMeeting()
				.then(() => {
					const response: ExtensionResponse = { success: true };
					sendResponse(response);
				})
				.catch((error: ErrorObject) => {
					// Fails with error codes: 009, 010, 011, 012, 013, 014
					const response: ExtensionResponse = { success: false, message: error };
					sendResponse(response);
				})
				.finally(() => {
					clearTabIdAndApplyUpdate();
				});
		});
	}

	if (message.type === "download_transcript_at_index") {
		if (typeof message.index === "number" && message.index >= 0) {
			// Download the requested item
			downloadTranscript(message.index, false)
				.then(() => {
					const response: ExtensionResponse = { success: true };
					sendResponse(response);
				})
				.catch((error: ErrorObject) => {
					// Fails with error codes: 009, 010
					const response: ExtensionResponse = { success: false, message: error };
					sendResponse(response);
				});
		} else {
			const response: ExtensionResponse = { success: false, message: { errorCode: "015", errorMessage: "Invalid index" } };
			sendResponse(response);
		}
	}

	if (message.type === "retry_webhook_at_index") {
		if (typeof message.index === "number" && message.index >= 0) {
			// Handle webhook retry
			postTranscriptToWebhook(message.index)
				.then(() => {
					const response: ExtensionResponse = { success: true };
					sendResponse(response);
				})
				.catch((error: ErrorObject) => {
					// Fails with error codes: 009, 010, 011, 012
					console.error("Webhook retry failed:", error);
					const response: ExtensionResponse = { success: false, message: error };
					sendResponse(response);
				});
		} else {
			const response: ExtensionResponse = { success: false, message: { errorCode: "015", errorMessage: "Invalid index" } };
			sendResponse(response);
		}
	}

	if (message.type === "recover_last_meeting") {
		recoverLastMeeting()
			.then((message: string) => {
				const response: ExtensionResponse = { success: true, message: message };
				sendResponse(response);
			})
			.catch((error: ErrorObject) => {
				// Fails with error codes: 009, 010, 011, 012, 013, 014
				const response: ExtensionResponse = { success: false, message: error };
				sendResponse(response);
			});
	}

	if (message.type === "register_content_scripts") {
		registerContentScripts()
			.then((message: string) => {
				const response: ExtensionResponse = { success: true, message: message };
				sendResponse(response);
			})
			.catch((error: ErrorObject) => {
				// Fails with error codes: not defined
				const response: ExtensionResponse = { success: false, message: error };
				sendResponse(response);
			});
	}

	return true;
});

// Download last meeting if meeting tab is closed
chrome.tabs.onRemoved.addListener(function (tabId: number) {
	chrome.storage.local.get(["meetingTabId"], function (resultLocalUntyped) {
		const resultLocal = resultLocalUntyped as ResultLocal;

		if (tabId === resultLocal.meetingTabId) {
			console.log("Successfully intercepted tab close");

			// Prevent misfires of onRemoved until next meeting. Also prevents available update from being applied, during meeting post processing.
			chrome.storage.local.set({ meetingTabId: "processing" }, function () {
				console.log("Meeting tab id set to processing meeting");

				processLastMeeting().finally(() => {
					clearTabIdAndApplyUpdate();
				});
			});
		}
	});
});

// Listen for extension updates
chrome.runtime.onUpdateAvailable.addListener(() => {
	// Check if there is an active meeting
	chrome.storage.local.get(["meetingTabId"], function (resultUntyped) {
		const result = resultUntyped as ResultLocal;

		if (result.meetingTabId) {
			// There is an active meeting(values: tabId or processing), defer the update
			chrome.storage.local.set({ isDeferredUpdatedAvailable: true }, function () {
				console.log("Deferred update flag set");
			});
		} else {
			// No active meeting, apply the update immediately. Meeting tab id is nullified only post meeting operations are done, so no race conditions.
			console.log("No active meeting, applying update immediately");
			chrome.runtime.reload();
		}
	});
});

// Register content scripts whenever runtime permission is provided by the user
chrome.permissions.onAdded.addListener((event) => {
	if (
		event.origins?.includes("https://*.zoom.us/*") &&
		event.origins?.includes("https://teams.live.com/*") &&
		event.origins?.includes("https://teams.microsoft.com/*")
	) {
		registerContentScripts();
	}
});

chrome.runtime.onInstalled.addListener(() => {
	// Re-register content scripts whenever extension is installed or updated, provided permissions are available
	chrome.permissions.getAll().then((permissions) => {
		if (
			permissions.origins?.includes("https://*.zoom.us/*") &&
			permissions.origins?.includes("https://teams.live.com/*") &&
			permissions.origins?.includes("https://teams.microsoft.com/*")
		) {
			registerContentScripts(false);
		}
	});

	// Set defaults values
	chrome.storage.sync.get(["autoPostWebhookAfterMeeting", "operationMode", "webhookBodyType", "webhookUrl"], function (resultSyncUntyped) {
		const resultSync = resultSyncUntyped as ResultSync;

		chrome.storage.sync.set(
			{
				autoPostWebhookAfterMeeting: resultSync.autoPostWebhookAfterMeeting === false ? false : true,
				operationMode: resultSync.operationMode === "manual" ? "manual" : "auto",
				webhookBodyType: resultSync.webhookBodyType === "advanced" ? "advanced" : "simple",
			},
			function () {}
		);
	});
});

// Download transcripts, post webhook if URL is enabled and available
// Fails if transcript is empty or webhook request fails or if no meetings in storage
// @throws error codes: 009, 010, 011, 012, 013, 014
function processLastMeeting(): Promise<string> {
	return new Promise((resolve, reject) => {
		pickupLastMeetingFromStorage()
			.then(() => {
				chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
					const resultLocal = resultLocalUntyped as ResultLocal;
					chrome.storage.sync.get(["webhookUrl", "autoPostWebhookAfterMeeting"], function (resultSyncUntyped) {
						const resultSync = resultSyncUntyped as ResultSync;

						// Create an array of promises to execute in parallel
						const promises: Promise<string>[] = [];

						// Meeting index to download and post webhook
						const lastIndex = resultLocal.meetings!.length - 1;

						// Promise to download transcript
						promises.push(
							downloadTranscript(
								lastIndex,
								// Just for anonymous analytics
								resultSync.webhookUrl && resultSync.autoPostWebhookAfterMeeting ? true : false
							)
						);

						// Promise to post webhook if enabled
						if (resultSync.autoPostWebhookAfterMeeting && resultSync.webhookUrl) {
							promises.push(postTranscriptToWebhook(lastIndex));
						}

						// Execute all promises in parallel
						Promise.all(promises)
							.then(() => {
								resolve("Meeting processing and download/webhook posting complete");
							})
							.catch((error: ErrorObject) => {
								// Fails with error codes: 009, 010, 011, 012
								console.error("Operation failed:", error.errorMessage);
								reject({ errorCode: error.errorCode, errorMessage: error.errorMessage });
							});
					});
				});
			})
			.catch((error: ErrorObject) => {
				// Fails with error codes: 013, 014
				reject({ errorCode: error.errorCode, errorMessage: error.errorMessage });
			});
	});
}

// Process transcript and chat messages of the meeting that just ended from storage, format them into strings, and save as a new entry in meetings (keeping last 10)
// @throws error codes: 013, 014
function pickupLastMeetingFromStorage(): Promise<string> {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(
			["meetingSoftware", "meetingTitle", "meetingStartTimestamp", "transcript", "chatMessages"],
			function (resultUntyped) {
				const result = resultUntyped as ResultLocal;

				if (result.meetingStartTimestamp) {
					if ((result.transcript && result.transcript.length > 0) || (result.chatMessages && result.chatMessages.length > 0)) {
						// Create new transcript entry
						const newMeetingEntry: Meeting = {
							meetingSoftware: result.meetingSoftware ? result.meetingSoftware : "",
							meetingTitle: result.meetingTitle,
							meetingStartTimestamp: result.meetingStartTimestamp,
							meetingEndTimestamp: new Date().toISOString(),
							transcript: result.transcript || [],
							chatMessages: result.chatMessages || [],
							webhookPostStatus: "new",
						};

						// Get existing recent meetings and add the new meeting
						chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
							const resultLocal = resultLocalUntyped as ResultLocal;
							let meetings = resultLocal.meetings || [];
							meetings.push(newMeetingEntry);

							// Keep only last 10 transcripts
							if (meetings.length > 10) {
								meetings = meetings.slice(-10);
							}

							// Save updated recent transcripts
							chrome.storage.local.set({ meetings: meetings }, function () {
								console.log("Last meeting picked up");
								resolve("Last meeting picked up");
							});
						});
					} else {
						reject({ errorCode: "014", errorMessage: "Empty transcript and empty chatMessages" });
					}
				} else {
					reject({ errorCode: "013", errorMessage: "No meetings found. May be attend one?" });
				}
			}
		);
	});
}

// @throws error codes: 009, 010
function downloadTranscript(index: number, isWebhookEnabled: boolean): Promise<string> {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
			const resultLocal = resultLocalUntyped as ResultLocal;

			if (resultLocal.meetings && resultLocal.meetings[index]) {
				const meeting = resultLocal.meetings[index];

				// Sanitise meeting title to prevent invalid file name errors
				// https://stackoverflow.com/a/78675894
				const invalidFilenameRegex =
					/[:?"*<>|~/\\\u{1}-\u{1f}\u{7f}\u{80}-\u{9f}\p{Cf}\p{Cn}]|^[.\u{0}\p{Zl}\p{Zp}\p{Zs}]|[.\u{0}\p{Zl}\p{Zp}\p{Zs}]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/giu;
				let sanitisedMeetingTitle = "Meeting";
				if (meeting.meetingTitle) {
					sanitisedMeetingTitle = meeting.meetingTitle.replaceAll(invalidFilenameRegex, "_");
				} else if (meeting.title) {
					sanitisedMeetingTitle = meeting.title.replaceAll(invalidFilenameRegex, "_");
				}

				// Format timestamp for human-readable filename and sanitise to prevent invalid filenames
				const timestamp = new Date(meeting.meetingStartTimestamp);
				const formattedTimestamp = timestamp.toLocaleString("default", timeFormat).replace(/[\/:]/g, "-");

				const prefix = meeting.meetingSoftware ? `${meeting.meetingSoftware} transcript` : "Transcript";

				const fileName = `TranscripTonic/${prefix}-${sanitisedMeetingTitle} at ${formattedTimestamp} on.txt`;

				// Format transcript and chatMessages content
				let content = getTranscriptString(meeting.transcript);
				content += `\n\n---------------\nCHAT MESSAGES\n---------------\n\n`;
				content += getChatMessagesString(meeting.chatMessages);

				// Add branding
				content += "\n\n---------------\n";
				content +=
					"Transcript saved using TranscripTonic Chrome extension (https://chromewebstore.google.com/detail/ciepnfnceimjehngolkijpnbappkkiag)";
				content += "\n---------------";

				const blob = new Blob([content], { type: "text/plain" });

				// Read the blob as a data URL
				const reader = new FileReader();

				// Read the blob
				reader.readAsDataURL(blob);

				// Download as text file, once blob is read
				reader.onload = function (event) {
					if (event.target?.result) {
						const dataUrl = event.target.result as string;

						// Create a download with Chrome Download API
						chrome.downloads
							.download({
								url: dataUrl,
								filename: fileName,
								conflictAction: "uniquify",
							})
							.then(() => {
								console.log("Transcript downloaded");
								resolve("Transcript downloaded successfully");

								// Increment anonymous transcript generated count to a Google sheet
								fetch(
									`https://script.google.com/macros/s/AKfycbxgUPDKDfreh2JIs8pIC-9AyQJxq1lx9Q1qI2SVBjJRvXQrYCPD2jjnBVQmds2mYeD5nA/exec?version=${
										chrome.runtime.getManifest().version
									}&isWebhookEnabled=${isWebhookEnabled}&meetingSoftware=${meeting.meetingSoftware}`,
									{
										mode: "no-cors",
									}
								);
							})
							.catch((err) => {
								console.error(err);
								chrome.downloads.download({
									url: dataUrl,
									filename: "TranscripTonic/Transcript.txt",
									conflictAction: "uniquify",
								});
								console.log("Invalid file name. Transcript downloaded to TranscripTonic directory with simple file name.");
								resolve("Transcript downloaded successfully with default file name");

								// Logs anonymous errors to a Google sheet for swift debugging
								fetch(
									`https://script.google.com/macros/s/AKfycbwN-bVkVv3YX4qvrEVwG9oSup0eEd3R22kgKahsQ3bCTzlXfRuaiO7sUVzH9ONfhL4wbA/exec?version=${
										chrome.runtime.getManifest().version
									}&code=009&error=${encodeURIComponent(err)}&meetingSoftware=${meeting.meetingSoftware}`,
									{ mode: "no-cors" }
								);

								// Increment anonymous transcript generated count to a Google sheet
								fetch(
									`https://script.google.com/macros/s/AKfycbxgUPDKDfreh2JIs8pIC-9AyQJxq1lx9Q1qI2SVBjJRvXQrYCPD2jjnBVQmds2mYeD5nA/exec?version=${
										chrome.runtime.getManifest().version
									}&isWebhookEnabled=${isWebhookEnabled}&meetingSoftware=${meeting.meetingSoftware}`,
									{
										mode: "no-cors",
									}
								);
							});
					} else {
						reject({ errorCode: "009", errorMessage: "Failed to read blob" });
					}
				};
			} else {
				reject({ errorCode: "010", errorMessage: "Meeting at specified index not found" });
			}
		});
	});
}

// @throws error code: 010, 011, 012
function postTranscriptToWebhook(index: number): Promise<string> {
	return new Promise((resolve, reject) => {
		// Get webhook URL and meetings
		chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
			const resultLocal = resultLocalUntyped as ResultLocal;
			chrome.storage.sync.get(["webhookUrl", "webhookBodyType"], function (resultSyncUntyped) {
				const resultSync = resultSyncUntyped as ResultSync;

				if (resultSync.webhookUrl) {
					if (resultLocal.meetings && resultLocal.meetings[index]) {
						const meeting = resultLocal.meetings[index];

						let webhookData: WebhookBody;
						if (resultSync.webhookBodyType === "advanced") {
							webhookData = {
								webhookBodyType: "advanced",
								meetingSoftware: meeting.meetingSoftware ? meeting.meetingSoftware : "",
								meetingTitle: meeting.meetingTitle || meeting.title || "",
								meetingStartTimestamp: new Date(meeting.meetingStartTimestamp).toISOString(),
								meetingEndTimestamp: new Date(meeting.meetingEndTimestamp).toISOString(),
								transcript: meeting.transcript,
								chatMessages: meeting.chatMessages,
							};
						} else {
							webhookData = {
								webhookBodyType: "simple",
								meetingSoftware: meeting.meetingSoftware ? meeting.meetingSoftware : "",
								meetingTitle: meeting.meetingTitle || meeting.title || "",
								meetingStartTimestamp: new Date(meeting.meetingStartTimestamp).toLocaleString("default", timeFormat).toUpperCase(),
								meetingEndTimestamp: new Date(meeting.meetingEndTimestamp).toLocaleString("default", timeFormat).toUpperCase(),
								transcript: getTranscriptString(meeting.transcript),
								chatMessages: getChatMessagesString(meeting.chatMessages),
							};
						}

						// Post to webhook
						fetch(resultSync.webhookUrl, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify(webhookData),
						})
							.then((response) => {
								if (!response.ok) {
									throw new Error(`Webhook request failed with HTTP status code ${response.status} ${response.statusText}`);
								}
							})
							.then(() => {
								// Update success status.
								resultLocal.meetings![index].webhookPostStatus = "successful";
								chrome.storage.local.set({ meetings: resultLocal.meetings }, function () {
									resolve("Webhook posted successfully");
								});
							})
							.catch((error) => {
								console.error(error);
								// Update failure status.
								resultLocal.meetings![index].webhookPostStatus = "failed";
								chrome.storage.local.set({ meetings: resultLocal.meetings }, function () {
									// Create notification and open webhooks page
									chrome.notifications.create(
										{
											type: "basic",
											iconUrl: "icon.png",
											title: "Could not post webhook!",
											message: "Click to view status and retry. Check console for more details.",
										},
										function (notificationId) {
											// Handle notification click
											chrome.notifications.onClicked.addListener(function (clickedNotificationId) {
												if (clickedNotificationId === notificationId) {
													chrome.tabs.create({ url: "meetings.html" });
												}
											});
										}
									);
									reject({ errorCode: "011", errorMessage: error });
								});
							});
					} else {
						reject({ errorCode: "010", errorMessage: "Meeting at specified index not found" });
					}
				} else {
					reject({ errorCode: "012", errorMessage: "No webhook URL configured" });
				}
			});
		});
	});
}

/**
 * Format transcript entries into string
 */
function getTranscriptString(transcript: TranscriptBlock[] | []): string {
	let transcriptString = "";
	if (transcript.length > 0) {
		transcript.forEach((transcriptBlock) => {
			transcriptString += `${transcriptBlock.personName} (${new Date(transcriptBlock.timestamp)
				.toLocaleString("default", timeFormat)
				.toUpperCase()})\n`;
			transcriptString += transcriptBlock.transcriptText;
			transcriptString += "\n\n";
		});
		return transcriptString;
	}
	return transcriptString;
}

/**
 * Format chat messages into string
 */
function getChatMessagesString(chatMessages: ChatMessage[] | []): string {
	let chatMessagesString = "";
	if (chatMessages.length > 0) {
		chatMessages.forEach((chatMessage) => {
			chatMessagesString += `${chatMessage.personName} (${new Date(chatMessage.timestamp)
				.toLocaleString("default", timeFormat)
				.toUpperCase()})\n`;
			chatMessagesString += chatMessage.chatMessageText;
			chatMessagesString += "\n\n";
		});
	}
	return chatMessagesString;
}

function clearTabIdAndApplyUpdate(): void {
	// Nullify to indicate end of meeting processing
	chrome.storage.local.set({ meetingTabId: null }, function () {
		console.log("Meeting tab id cleared for next meeting");

		// Check if there's a deferred update
		chrome.storage.local.get(["isDeferredUpdatedAvailable"], function (resultLocalUntyped) {
			const resultLocal = resultLocalUntyped as ResultLocal;

			if (resultLocal.isDeferredUpdatedAvailable) {
				console.log("Applying deferred update");
				chrome.storage.local.set({ isDeferredUpdatedAvailable: false }, function () {
					chrome.runtime.reload();
				});
			}
		});
	});
}

// @throws error codes: 009, 010, 011, 012, 013, 014
function recoverLastMeeting(): Promise<string> {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(["meetings", "meetingStartTimestamp"], function (resultLocalUntyped) {
			const resultLocal = resultLocalUntyped as ResultLocal;
			// Check if user ever attended a meeting
			if (resultLocal.meetingStartTimestamp) {
				let lastSavedMeeting: Meeting | undefined;
				if (resultLocal.meetings && resultLocal.meetings.length > 0) {
					lastSavedMeeting = resultLocal.meetings[resultLocal.meetings.length - 1];
				}

				// Last meeting was not processed for some reason. Need to recover that data, process and download it.
				if (!lastSavedMeeting || resultLocal.meetingStartTimestamp !== lastSavedMeeting.meetingStartTimestamp) {
					processLastMeeting()
						.then(() => {
							resolve("Recovered last meeting to the best possible extent");
						})
						.catch((error: ErrorObject) => {
							// Fails with error codes: 009, 010, 011, 013, 014
							reject({ errorCode: error.errorCode, errorMessage: error.errorMessage });
						});
				} else {
					resolve("No recovery needed");
				}
			} else {
				reject({ errorCode: "013", errorMessage: "No meetings found. May be attend one?" });
			}
		});
	});
}

function registerContentScripts(showNotification: boolean = true): Promise<string> {
	return new Promise((resolve, reject) => {
		chrome.scripting.getRegisteredContentScripts().then((scripts) => {
			let isContentZoomRegistered = false;
			let isContentTeamsRegistered = false;
			scripts.forEach((script) => {
				if (script.id === "content-zoom") {
					isContentZoomRegistered = true;
					console.log("Zoom content script already registered");
				}
				if (script.id === "content-teams") {
					isContentTeamsRegistered = true;
					console.log("Teams content script already registered");
				}
			});

			if (isContentTeamsRegistered && isContentTeamsRegistered) {
				resolve("Zoom and Teams content scripts already registered");
				return;
			}

			const promises: Promise<void>[] = [];

			if (!isContentZoomRegistered) {
				const zoomRegistrationPromise = chrome.scripting.registerContentScripts([
					{
						id: "content-zoom",
						js: ["content-zoom.js"],
						matches: ["https://*.zoom.us/*"],
						runAt: "document_end",
					},
				]);
				promises.push(zoomRegistrationPromise);
			}

			if (!isContentTeamsRegistered) {
				const teamsRegistrationPromise = chrome.scripting.registerContentScripts([
					{
						id: "content-teams",
						js: ["content-teams.js"],
						matches: ["https://teams.live.com/*", "https://teams.microsoft.com/*"],
						runAt: "document_end",
					},
				]);
				promises.push(teamsRegistrationPromise);
			}

			Promise.all(promises)
				.then(() => {
					console.log("Both Zoom and Teams content scripts registered successfully.");
					resolve("Zoom and Teams content scripts registered");

					if (showNotification) {
						chrome.permissions
							.contains({
								permissions: ["notifications"],
							})
							.then((hasPermission) => {
								if (hasPermission) {
									chrome.notifications.create({
										type: "basic",
										iconUrl: "icon.png",
										title: "Enabled! Join Zoom/Teams meetings on the browser",
										message: "Refresh any existing Zoom/Teams pages",
									});
								}
							});
					}
				})
				.catch((error) => {
					// This block runs if EITHER Zoom OR Teams registration fails.
					console.error("One or more content script registrations failed.", error);
					reject("Failed to register one or more content scripts");
				});
		});
	});
}
