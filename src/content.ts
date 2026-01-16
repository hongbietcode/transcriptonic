//*********** GLOBAL VARIABLES **********//
interface TranscriptBlock {
	/** name of the person who spoke */
	personName: string;
	/** ISO timestamp of when the words were spoken */
	timestamp: string;
	/** actual transcript text */
	transcriptText: string;
}

interface ChatMessage {
	/** name of the person who sent the message */
	personName: string;
	/** ISO timestamp of when the message was sent */
	timestamp: string;
	/** actual message text */
	chatMessageText: string;
}

interface ExtensionStatusJSON {
	/** status of the extension */
	status: number;
	/** message of the status */
	message: string;
}

interface ExtensionMessage {
	type:
		| "new_meeting_started"
		| "meeting_ended"
		| "download_transcript_at_index"
		| "retry_webhook_at_index"
		| "recover_last_meeting"
		| "register_content_scripts";
	/** index of the meeting to process */
	index?: number;
}

interface StreamingMessage {
	type: "transcript_entry" | "meeting_info" | "meeting_started" | "meeting_ended";
	data?: TranscriptBlock | MeetingInfoData;
}

interface MeetingInfoData {
	meetingSoftware: MeetingSoftware;
	meetingTitle: string;
	meetingStartTimestamp: string;
}

interface ExtensionResponse {
	/** whether the message was processed successfully as per the request */
	success: boolean;
	/** message explaining success or failure */
	message?: string | ErrorObject;
}

interface ErrorObject {
	/** error code */
	errorCode: string;
	/** message explaining the error */
	errorMessage: string;
}

type MeetingSoftware = "Google Meet" | "Zoom" | "Teams" | "" | undefined;

interface ResultSync {
	autoPostWebhookAfterMeeting?: boolean;
	operationMode?: "auto" | "manual";
	webhookBodyType?: "simple" | "advanced";
	webhookUrl?: string;
}

const extensionStatusJSON_bug: ExtensionStatusJSON = {
	status: 400,
	message: `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="https://github.com/hongbietcode/transcriptonic/issues" target="_blank">here</a>.`,
};

const reportErrorMessage = "There is a bug in TranscripTonic. Please report it at https://github.com/hongbietcode/transcriptonic/issues";
const mutationConfig: MutationObserverInit = { childList: true, attributes: true, subtree: true, characterData: true };

// Name of the person attending the meeting
let userName = "You";

// Transcript array that holds one or more transcript blocks
let transcript: TranscriptBlock[] = [];

// Buffer variables to dump values, which get pushed to transcript array as transcript blocks, at defined conditions

let personNameBuffer = "",
	transcriptTextBuffer = "",
	timestampBuffer = "";

// Chat messages array that holds one or more chat messages of the meeting
let chatMessages: ChatMessage[] = [];

const meetingSoftware: MeetingSoftware = "Google Meet";

// Capture meeting start timestamp, stored in ISO format
let meetingStartTimestamp = new Date().toISOString();
let meetingTitle = document.title;

// Capture invalid transcript and chatMessages DOM element error for the first time and silence for the rest of the meeting to prevent notification noise
let isTranscriptDomErrorCaptured = false;
let isChatMessagesDomErrorCaptured = false;

// Capture meeting begin to abort userName capturing interval
let hasMeetingStarted = false;

// Capture meeting end to suppress any errors
let hasMeetingEnded = false;

// Throttle live streaming - send max every 300ms
let lastStreamTime = 0;
const STREAM_THROTTLE_MS = 300;

let extensionStatusJSON: ExtensionStatusJSON;

// Attempt to recover last meeting, if any. Abort if it takes more than 2 seconds to prevent current meeting getting messed up.
Promise.race([
	recoverLastMeeting(),
	new Promise<never>((_, reject) => setTimeout(() => reject({ errorCode: "016", errorMessage: "Recovery timed out" }), 2000)),
])
	.catch((error: unknown) => {
		const parsedError = error as ErrorObject;
		if (parsedError.errorCode !== "013" && parsedError.errorCode !== "014") {
			console.error(parsedError.errorMessage);
		}
	})
	.finally(() => {
		// Save current meeting data to chrome storage once recovery is complete or is aborted
		overWriteChromeStorage(["meetingSoftware", "meetingStartTimestamp", "meetingTitle", "transcript", "chatMessages"], false);
	});

//*********** MAIN FUNCTIONS **********//
checkExtensionStatus().finally(() => {
	console.log("Extension status " + extensionStatusJSON.status);

	// Enable extension functions only if status is 200
	if (extensionStatusJSON.status === 200) {
		// NON CRITICAL DOM DEPENDENCY. Attempt to get username before meeting starts. Abort interval if valid username is found or if meeting starts and default to "You".
		waitForElement(".awLEm").then(() => {
			// Poll the element until the textContent loads from network or until meeting starts
			const captureUserNameInterval = setInterval(() => {
				if (!hasMeetingStarted) {
					const capturedUserName = document.querySelector(".awLEm")?.textContent;
					if (capturedUserName) {
						userName = capturedUserName;
						clearInterval(captureUserNameInterval);
					}
				} else {
					clearInterval(captureUserNameInterval);
				}
			}, 100);
		});

		// 1. Meet UI prior to July/Aug 2024
		// meetingRoutines(1)

		// 2. Meet UI post July/Aug 2024
		meetingRoutines(2);
	} else {
		// Show downtime message as extension status is 400
		showNotification(extensionStatusJSON);
	}
});

function meetingRoutines(uiType: number): void {
	const meetingEndIconData = {
		selector: "",
		text: "",
	};
	const captionsIconData = {
		selector: "",
		text: "",
	};
	// Different selector data for different UI versions
	switch (uiType) {
		case 1:
			meetingEndIconData.selector = ".google-material-icons";
			meetingEndIconData.text = "call_end";
			captionsIconData.selector = ".material-icons-extended";
			captionsIconData.text = "closed_caption_off";
			break;
		case 2:
			meetingEndIconData.selector = ".google-symbols";
			meetingEndIconData.text = "call_end";
			captionsIconData.selector = ".google-symbols";
			captionsIconData.text = "closed_caption_off";
			break;
		default:
			break;
	}

	// CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
	waitForElement(meetingEndIconData.selector, meetingEndIconData.text).then(() => {
		console.log("Meeting started");
		const message: ExtensionMessage = {
			type: "new_meeting_started",
		};
		chrome.runtime.sendMessage(message, function () {});
		hasMeetingStarted = true;
		// Update meeting startTimestamp
		meetingStartTimestamp = new Date().toISOString();
		overWriteChromeStorage(["meetingStartTimestamp"], false);

		// Stream meeting started
		safeSendMessage({ type: "meeting_started" });

		//*********** MEETING START ROUTINES **********//
		updateMeetingTitle();

		// Stream meeting info after title is updated (7.5s delay)
		setTimeout(() => {
			safeSendMessage({
				type: "meeting_info",
				data: { meetingSoftware, meetingTitle, meetingStartTimestamp },
			});
		}, 7500);

		let transcriptObserver: MutationObserver;
		let chatMessagesObserver: MutationObserver;

		// **** REGISTER TRANSCRIPT LISTENER **** //
		// Wait for captions icon to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the captions icon is still not visible.
		waitForElement(captionsIconData.selector, captionsIconData.text).then(() => {
			// CRITICAL DOM DEPENDENCY
			const captionsButton = selectElements(captionsIconData.selector, captionsIconData.text)[0] as HTMLElement;

			// Click captions icon for non manual operation modes. Async operation.
			chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
				const resultSync = resultSyncUntyped as ResultSync;
				if (resultSync.operationMode === "manual") {
					console.log("Manual mode selected, leaving transcript off");
				} else {
					captionsButton.click();
				}
			});

			// Allow DOM to be updated and then register transcript mutation observer
			waitForElement(`div[role="region"][tabindex="0"]`)
				.then(() => {
					// CRITICAL DOM DEPENDENCY. Grab the transcript element. This element is present, irrespective of captions ON/OFF, so this executes independent of operation mode.
					const transcriptTargetNode = document.querySelector(`div[role="region"][tabindex="0"]`);

					if (transcriptTargetNode) {
						// Create transcript observer instance linked to the callback function. Registered irrespective of operation mode, so that any visible transcript can be picked up during the meeting, independent of the operation mode.
						transcriptObserver = new MutationObserver(transcriptMutationCallback);

						// Start observing the transcript element and chat messages element for configured mutations
						transcriptObserver.observe(transcriptTargetNode, mutationConfig);
					} else {
						throw new Error("Transcript element not found in DOM");
					}
				})
				.catch((err: unknown) => {
					console.error(err);
					isTranscriptDomErrorCaptured = true;
					showNotification(extensionStatusJSON_bug);

					logError("001", err);
				});
		});

		// **** REGISTER CHAT MESSAGES LISTENER **** //
		// Wait for chat icon to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the chat icon is still not visible.
		waitForElement(".google-symbols", "chat")
			.then(() => {
				const chatMessagesButton = selectElements(".google-symbols", "chat")[0] as HTMLElement;
				// Force open chat messages to make the required DOM to appear. Otherwise, the required chatMessages DOM element is not available.
				chatMessagesButton.click();

				// Allow DOM to be updated, close chat messages and then register chatMessage mutation observer
				waitForElement(`div[aria-live="polite"].Ge9Kpc`).then(() => {
					chatMessagesButton.click();
					// CRITICAL DOM DEPENDENCY. Grab the chat messages element. This element is present, irrespective of chat ON/OFF, once it appears for this first time.
					try {
						const chatMessagesTargetNode = document.querySelector(`div[aria-live="polite"].Ge9Kpc`);

						// Create chat messages observer instance linked to the callback function. Registered irrespective of operation mode.
						if (chatMessagesTargetNode) {
							chatMessagesObserver = new MutationObserver(chatMessagesMutationCallback);
							chatMessagesObserver.observe(chatMessagesTargetNode, mutationConfig);
						} else {
							throw new Error("Chat messages element not found in DOM");
						}
					} catch (err) {
						console.error(err);
						isChatMessagesDomErrorCaptured = true;
						showNotification(extensionStatusJSON_bug);

						logError("002", err);
					}
				});
			})
			.catch((err: unknown) => {
				console.error(err);
				isChatMessagesDomErrorCaptured = true;
				showNotification(extensionStatusJSON_bug);

				logError("003", err);
			});

		// Show confirmation message from extensionStatusJSON, once observation has started, based on operation mode
		if (!isTranscriptDomErrorCaptured && !isChatMessagesDomErrorCaptured) {
			chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
				const resultSync = resultSyncUntyped as ResultSync;
				if (resultSync.operationMode === "manual") {
					showNotification({
						status: 400,
						message: "<strong>TranscripTonic is not running</strong> <br /> Turn on captions using the CC icon, if needed",
					});
				} else {
					showNotification(extensionStatusJSON);
				}
			});
		}

		//*********** MEETING END ROUTINES **********//
		try {
			// CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
			selectElements(meetingEndIconData.selector, meetingEndIconData.text)[0].parentElement!.parentElement!.addEventListener("click", () => {
				// To suppress further errors
				hasMeetingEnded = true;
				if (transcriptObserver) {
					transcriptObserver.disconnect();
				}
				if (chatMessagesObserver) {
					chatMessagesObserver.disconnect();
				}

				// Push any data in the buffer variables to the transcript array, but avoid pushing blank ones. Needed to handle one or more speaking when meeting ends.
				if (personNameBuffer !== "" && transcriptTextBuffer !== "") {
					pushBufferToTranscript();
				}
				// Stream meeting ended
				safeSendMessage({ type: "meeting_ended" });
				// Save to chrome storage and send message to download transcript from background script
				overWriteChromeStorage(["transcript", "chatMessages"], true);
			});
		} catch (err) {
			console.error(err);
			showNotification(extensionStatusJSON_bug);

			logError("004", err);
		}
	});
}

//*********** CALLBACK FUNCTIONS **********//
function transcriptMutationCallback(mutationsList: MutationRecord[]): void {
	mutationsList.forEach((mutation) => {
		try {
			if (mutation.type === "characterData") {
				const mutationTargetElement = (mutation.target as Node).parentElement;
				const transcriptUIBlocks = Array.from(mutationTargetElement?.parentElement?.parentElement?.children || []);
				const isLastButSecondElement =
					transcriptUIBlocks[transcriptUIBlocks.length - 3] === mutationTargetElement?.parentElement ? true : false;

				// Pick up only last second element (the last and last but one are non transcript elements), since Meet mutates previous blocks to make minor corrections. Picking them up leads to repetitive transcript blocks in the result.
				if (isLastButSecondElement) {
					// Attempt to dim down the current transcript
					Array.from(transcriptUIBlocks[transcriptUIBlocks.length - 3].children).forEach((item) => {
						item.setAttribute("style", "opacity:0.2");
					});

					const currentPersonName = mutationTargetElement?.previousSibling?.textContent;
					const currentTranscriptText = mutationTargetElement?.textContent;

					if (currentPersonName && currentTranscriptText) {
						// Starting fresh in a meeting or resume from no active transcript
						if (transcriptTextBuffer === "") {
							personNameBuffer = currentPersonName;
							timestampBuffer = new Date().toISOString();
							transcriptTextBuffer = currentTranscriptText;
						}
						// Some prior transcript buffer exists
						else {
							// New person started speaking
							if (personNameBuffer !== currentPersonName) {
								// Push previous person's transcript as a block
								pushBufferToTranscript();

								// Update buffers for next mutation and store transcript block timestamp
								personNameBuffer = currentPersonName;
								timestampBuffer = new Date().toISOString();
								transcriptTextBuffer = currentTranscriptText;
							}
							// Same person speaking more
							else {
								// When the same person speaks for more than 30 min (approx), Meet drops very long transcript for current person and starts over, which is detected by current transcript string being significantly smaller than the previous one
								if (currentTranscriptText.length - transcriptTextBuffer.length < -250) {
									// Push the long transcript
									pushBufferToTranscript();

									// Store transcript block timestamp for next transcript block of same person
									timestampBuffer = new Date().toISOString();
								}

								// Update buffers for next mutation
								transcriptTextBuffer = currentTranscriptText;
							}
						}

						// Live streaming - throttled to avoid overwhelming with messages
						if (personNameBuffer && transcriptTextBuffer) {
							const now = Date.now();
							if (now - lastStreamTime >= STREAM_THROTTLE_MS) {
								lastStreamTime = now;
								safeSendMessage({
									type: "transcript_entry",
									data: {
										personName: personNameBuffer === "You" ? userName : personNameBuffer,
										timestamp: timestampBuffer,
										transcriptText: transcriptTextBuffer,
									},
								});
							}
						}
					}
					// No people found in transcript DOM
					else {
						// No transcript yet or the last person stopped speaking(and no one has started speaking next)
						console.log("No active transcript");
						// Push data in the buffer variables to the transcript array, but avoid pushing blank ones.
						if (personNameBuffer !== "" && transcriptTextBuffer !== "") {
							pushBufferToTranscript();
						}
						// Update buffers for the next person in the next mutation
						personNameBuffer = "";
						transcriptTextBuffer = "";
					}
				}
			}

			// Logs to indicate that the extension is working
			if (transcriptTextBuffer.length > 125) {
				console.log(transcriptTextBuffer.slice(0, 50) + "   ...   " + transcriptTextBuffer.slice(-50));
			} else {
				console.log(transcriptTextBuffer);
			}
		} catch (err) {
			console.error(err);
			if (!isTranscriptDomErrorCaptured && !hasMeetingEnded) {
				console.log(reportErrorMessage);
				showNotification(extensionStatusJSON_bug);

				logError("005", err);
			}
			isTranscriptDomErrorCaptured = true;
		}
	});
}

function chatMessagesMutationCallback(mutationsList: MutationRecord[]): void {
	mutationsList.forEach(() => {
		try {
			// CRITICAL DOM DEPENDENCY
			const chatMessagesElement = document.querySelector(`div[aria-live="polite"].Ge9Kpc`);
			// Attempt to parse messages only if at least one message exists
			if (chatMessagesElement && chatMessagesElement.children.length > 0) {
				// CRITICAL DOM DEPENDENCY. Get the last message that was sent/received.
				const chatMessageElement = chatMessagesElement.lastChild?.firstChild?.firstChild?.lastChild as Element | undefined;
				// CRITICAL DOM DEPENDENCY
				const personAndTimestampElement = chatMessageElement?.firstChild as Element | undefined;
				const personName = personAndTimestampElement?.childNodes.length === 1 ? userName : personAndTimestampElement?.firstChild?.textContent;
				const timestamp = new Date().toISOString();
				// CRITICAL DOM DEPENDENCY
				const chatMessageText = (chatMessageElement?.lastChild?.lastChild?.firstChild?.firstChild?.firstChild as Element | undefined)
					?.textContent;

				if (personName && chatMessageText) {
					const chatMessageBlock: ChatMessage = {
						personName: personName,
						timestamp: timestamp,
						chatMessageText: chatMessageText,
					};

					// Lot of mutations fire for each message, pick them only once
					pushUniqueChatBlock(chatMessageBlock);
				}
			}
		} catch (err) {
			console.error(err);
			if (!isChatMessagesDomErrorCaptured && !hasMeetingEnded) {
				console.log(reportErrorMessage);
				showNotification(extensionStatusJSON_bug);

				logError("006", err);
			}
			isChatMessagesDomErrorCaptured = true;
		}
	});
}

//*********** HELPER FUNCTIONS **********//
function safeSendMessage(message: StreamingMessage): void {
	try {
		if (!chrome.runtime?.id) {
			if (message.type === "transcript_entry" || message.type === "meeting_ended") {
				console.warn("Extension context invalidated - transcript data may be lost. Please reload the extension.");
			}
			return;
		}
		chrome.runtime.sendMessage(message, () => {
			if (chrome.runtime.lastError) {
				if (message.type === "transcript_entry" || message.type === "meeting_ended") {
					console.warn("Failed to send message:", chrome.runtime.lastError.message);
				}
			}
		});
	} catch (err) {
		console.error("safeSendMessage - Exception:", err);
	}
}

function pushBufferToTranscript(): void {
	const entry: TranscriptBlock = {
		personName: personNameBuffer === "You" ? userName : personNameBuffer,
		timestamp: timestampBuffer,
		transcriptText: transcriptTextBuffer,
	};
	transcript.push(entry);
	safeSendMessage({ type: "transcript_entry", data: entry });
	overWriteChromeStorage(["transcript"], false);
}

function pushUniqueChatBlock(chatBlock: ChatMessage): void {
	const isExisting = chatMessages.some((item) => item.personName === chatBlock.personName && item.chatMessageText === chatBlock.chatMessageText);
	if (!isExisting) {
		console.log(chatBlock);
		chatMessages.push(chatBlock);
		overWriteChromeStorage(["chatMessages"], false);
	}
}

type StorageKey = "meetingSoftware" | "meetingTitle" | "meetingStartTimestamp" | "transcript" | "chatMessages";

function overWriteChromeStorage(keys: StorageKey[], sendDownloadMessage: boolean): void {
	const objectToSave: Record<string, unknown> = {};
	// Hard coded list of keys that are accepted
	if (keys.includes("meetingSoftware")) {
		objectToSave.meetingSoftware = meetingSoftware;
	}
	if (keys.includes("meetingTitle")) {
		objectToSave.meetingTitle = meetingTitle;
	}
	if (keys.includes("meetingStartTimestamp")) {
		objectToSave.meetingStartTimestamp = meetingStartTimestamp;
	}
	if (keys.includes("transcript")) {
		objectToSave.transcript = transcript;
	}
	if (keys.includes("chatMessages")) {
		objectToSave.chatMessages = chatMessages;
	}

	chrome.storage.local.set(objectToSave, function () {
		// Helps people know that the extension is working smoothly in the background
		pulseStatus();
		if (sendDownloadMessage) {
			const message: ExtensionMessage = {
				type: "meeting_ended",
			};
			chrome.runtime.sendMessage(message, (responseUntyped) => {
				const response = responseUntyped as ExtensionResponse;
				if (!response.success && typeof response.message === "object" && response.message?.errorCode === "010") {
					console.error(response.message.errorMessage);
				}
			});
		}
	});
}

function pulseStatus(): void {
	const statusActivityCSS = `position: fixed;
    top: 0px;
    width: 100%;
    height: 4px;
    z-index: 100;
    transition: background-color 0.3s ease-in
  `;

	let activityStatus = document.querySelector<HTMLDivElement>(`#transcriptonic-status`);
	if (!activityStatus) {
		let html = document.querySelector("html");
		activityStatus = document.createElement("div");
		activityStatus.setAttribute("id", "transcriptonic-status");
		activityStatus.style.cssText = `background-color: #2A9ACA; ${statusActivityCSS}`;
		html?.appendChild(activityStatus);
	} else {
		activityStatus.style.cssText = `background-color: #2A9ACA; ${statusActivityCSS}`;
	}

	setTimeout(() => {
		activityStatus!.style.cssText = `background-color: transparent; ${statusActivityCSS}`;
	}, 3000);
}

function updateMeetingTitle(): void {
	waitForElement(".u6vdEc").then((element) => {
		const meetingTitleElement = element as HTMLDivElement;
		meetingTitleElement?.setAttribute("contenteditable", "true");
		meetingTitleElement.title = "Edit meeting title for TranscripTonic";
		meetingTitleElement.style.cssText = `text-decoration: underline white; text-underline-offset: 4px;`;

		meetingTitleElement?.addEventListener("input", handleMeetingTitleElementChange);

		// Pick up meeting name after a delay, since Google meet updates meeting name after a delay
		setTimeout(() => {
			handleMeetingTitleElementChange();
			if (location.pathname === `/${meetingTitleElement.innerText}`) {
				showNotification({
					status: 200,
					message: "<b>Give this meeting a title?</b><br/>Edit the underlined text in the bottom left corner",
				});
			}
		}, 7000);

		function handleMeetingTitleElementChange() {
			meetingTitle = meetingTitleElement.innerText;
			overWriteChromeStorage(["meetingTitle"], false);
		}
	});
}

function selectElements(selector: string, text: string | RegExp): Element[] {
	const elements = document.querySelectorAll(selector);
	return Array.prototype.filter.call(elements, function (element: Element) {
		return RegExp(text).test(element.textContent || "");
	});
}

async function waitForElement(selector: string, text?: string | RegExp): Promise<Element | null> {
	if (text) {
		// loops for every animation frame change, until the required element is found
		while (!Array.from(document.querySelectorAll(selector)).find((element) => element.textContent === text)) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
	} else {
		// loops for every animation frame change, until the required element is found
		while (!document.querySelector(selector)) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
	}
	return document.querySelector(selector);
}

function showNotification(extensionStatusJSON: ExtensionStatusJSON): void {
	const html = document.querySelector("html");
	const notification = document.createElement("div");
	const content = document.createElement("div");
	const icon = document.createElement("div");
	const text = document.createElement("div");

	// Set icon and styles based on status
	if (extensionStatusJSON.status === 200) {
		icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
		</svg>`;
		notification.style.cssText = `${commonCSS} background: rgba(34, 197, 94, 0.95); border: 1px solid rgba(34, 197, 94, 1);`;
	} else {
		icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
		</svg>`;
		notification.style.cssText = `${commonCSS} background: rgba(245, 158, 11, 0.95); border: 1px solid rgba(245, 158, 11, 1);`;
	}

	text.innerHTML = extensionStatusJSON.message;
	content.appendChild(icon);
	content.appendChild(text);
	notification.appendChild(content);

	content.style.cssText = "display: flex; align-items: center; gap: 12px;";
	icon.style.cssText = "display: flex; flex-shrink: 0;";
	text.style.cssText = "flex: 1; font-size: 14px; line-height: 1.5;";

	if (html) html.appendChild(notification);

	// Slide in animation from left
	setTimeout(() => {
		notification.style.opacity = "1";
		notification.style.transform = "translateX(0)";
	}, 10);

	// Slide out and remove after 5s
	setTimeout(() => {
		notification.style.opacity = "0";
		notification.style.transform = "translateX(-8px)";
		setTimeout(() => notification.remove(), 300);
	}, 5000);
}

// CSS for notification
const commonCSS = `
	position: fixed;
	top: 20px;
	left: 20px;
	transform: translateX(-8px);
	z-index: 10000;
	padding: 12px 16px;
	border-radius: 8px;
	color: white;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-weight: 500;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
	backdrop-filter: blur(8px);
	opacity: 0;
	transition: all 0.3s ease;
	max-width: 420px;
	min-width: 320px;
`;

function logError(code: string, err: unknown): void {
	fetch(
		`https://script.google.com/macros/s/AKfycbwN-bVkVv3YX4qvrEVwG9oSup0eEd3R22kgKahsQ3bCTzlXfRuaiO7sUVzH9ONfhL4wbA/exec?version=${
			chrome.runtime.getManifest().version
		}&code=${code}&error=${encodeURIComponent(String(err))}&meetingSoftware=${meetingSoftware}`,
		{ mode: "no-cors" }
	);
}

function meetsMinVersion(oldVer: string, newVer: string): boolean {
	const oldParts = oldVer.split(".");
	const newParts = newVer.split(".");
	for (let i = 0; i < newParts.length; i++) {
		const a = ~~newParts[i]; // parse int
		const b = ~~oldParts[i]; // parse int
		if (a > b) return false;
		if (a < b) return true;
	}
	return true;
}

function checkExtensionStatus(): Promise<string> {
	return new Promise((resolve, reject) => {
		// Set default value as 200
		extensionStatusJSON = { status: 200, message: "Recording transcript • Keep captions on" };

		// https://stackoverflow.com/a/42518434
		fetch("https://raw.githubusercontent.com/hongbietcode/transcriptonic/refs/heads/main/docs/status.json", { cache: "no-store" })
			.then((response) => response.json())
			.then((result: { minVersion: string; status: number; message: string }) => {
				const minVersion = result.minVersion;

				// Disable extension if version is below the min version
				if (!meetsMinVersion(chrome.runtime.getManifest().version, minVersion)) {
					extensionStatusJSON.status = 400;
					extensionStatusJSON.message = `Update to v${minVersion} required • <a href="https://github.com/hongbietcode/transcriptonic/wiki/Manually-update-TranscripTonic" target="_blank" style="color: white; text-decoration: underline;">Click to update</a>`;
				} else {
					// Update status based on response
					extensionStatusJSON.status = result.status;
					extensionStatusJSON.message = result.message;
				}

				console.log("Extension status fetched and saved");
				resolve("Extension status fetched and saved");
			})
			.catch((err: unknown) => {
				console.error(err);
				reject("Could not fetch extension status");

				logError("008", err);
			});
	});
}

function recoverLastMeeting(): Promise<string> {
	return new Promise((resolve, reject) => {
		const message: ExtensionMessage = {
			type: "recover_last_meeting",
		};
		chrome.runtime.sendMessage(message, function (responseUntyped) {
			const response = responseUntyped as ExtensionResponse;
			if (response.success) {
				resolve("Last meeting recovered successfully or recovery not needed");
			} else {
				reject(response.message);
			}
		});
	});
}

// CURRENT GOOGLE MEET TRANSCRIPT DOM. TO BE UPDATED.

/* <div class="a4cQT kV7vwc eO2Zfd" jscontroller="D1tHje" jsaction="bz0DVc:HWTqGc;E18dRb:lUFH9b;QBUr8:lUFH9b;stc2ve:oh3Xke" style="">
  // CAPTION LANGUAGE SETTINGS. MAY OR MAY NOT HAVE CHILDREN
  <div class="NmXUuc  P9KVBf" jscontroller="rRafu" jsaction="F41Sec:tsH52e;OmFrlf:xfAI6e(zHUIdd)"></div>
  <div class="DtJ7e">
    <span class="frX3lc-vlkzWd  P9KVBf"></span>
    <div jsname="dsyhDe" class="iOzk7 uYs2ee " style="">
      //PERSON 1
      <div class="nMcdL bj4p3b" style="">
        <div class="adE6rb M6cG9d">
          <img alt="" class="Z6byG r6DyN" src="https://lh3.googleusercontent.com/a/some-url" data-iml="63197.699999999255">
            <div class="KcIKyf jxFHg">Person 1</div>
        </div>
        <div jsname="YSxPC" class="bYevke wY1pdd" style="height: 27.5443px;">
          <div jsname="tgaKEf" class="bh44bd VbkSUe">
            Some transcript text.
            Some more text.</div>
        </div>
      </div>
      //PERSON 2
      <div class="nMcdL bj4p3b" style="">
        <div class="adE6rb M6cG9d">
          <img alt="" class="Z6byG r6DyN" src="https://lh3.googleusercontent.com/a/some-url" data-iml="63197.699999999255">
            <div class="KcIKyf jxFHg">Person 2</div>
        </div>
        <div jsname="YSxPC" class="bYevke wY1pdd" style="height: 27.5443px;">
          <div jsname="tgaKEf" class="bh44bd VbkSUe">
            Some transcript text.
            Some more text.</div>
        </div>
      </div>
    </div>
    <div jsname="APQunf" class="iOzk7 uYs2ee" style="display: none;">
    </div>
  </div>
  <div jscontroller="mdnBv" jsaction="stc2ve:MO88xb;QBUr8:KNou4c">
  </div>
</div> */

// CURRENT GOOGLE MEET CHAT MESSAGES DOM
/* <div jsname="xySENc" aria-live="polite" jscontroller="Mzzivb" jsaction="nulN2d:XL2g4b;vrPT5c:XL2g4b;k9UrDc:ClCcUe"
  class="Ge9Kpc z38b6">
  <div class="Ss4fHf" jsname="Ypafjf" tabindex="-1" jscontroller="LQRnv"
    jsaction="JIbuQc:sCzVOd(aUCive),T4Iwcd(g21v4c),yyLnsd(iJEnyb),yFT8A(RNMM1e),Cg1Rgf(EZbOH)" style="order: 0;">
    <div class="QTyiie">
      <div class="poVWob">You</div>
      <div jsname="biJjHb" class="MuzmKe">17:00</div>
    </div>
    <div class="beTDc">
      <div class="er6Kjc chmVPb">
        <div class="ptNLrf">
          <div jsname="dTKtvb">
            <div jscontroller="RrV5Ic" jsaction="rcuQ6b:XZyPzc" data-is-tv="false">Hello</div>
          </div>
          <div class="pZBsfc">Hover over a message to pin it<i class="google-material-icons VfPpkd-kBDsod WRc1Nb"
              aria-hidden="true">keep</i></div>
          <div class="MMfG3b"><span tooltip-id="ucc-17"></span><span data-is-tooltip-wrapper="true"><button
                class="VfPpkd-Bz112c-LgbsSe yHy1rc eT1oJ tWDL4c Brnbv pFZkBd" jscontroller="soHxf"
                jsaction="click:cOuCgd; mousedown:UX7yZ; mouseup:lbsD7e; mouseenter:tfO1Yc; mouseleave:JywGue; touchstart:p6p2H; touchmove:FwuNnf; touchend:yfqBxc; touchcancel:JMtRjd; focus:AHmuwe; blur:O22p3e; contextmenu:mg9Pef;mlnRJb:fLiPzd"
                jsname="iJEnyb" data-disable-idom="true" aria-label="Pin message" data-tooltip-enabled="true"
                data-tooltip-id="ucc-17" data-tooltip-x-position="3" data-tooltip-y-position="2" role="button"
                data-message-id="1714476309237">
                <div jsname="s3Eaab" class="VfPpkd-Bz112c-Jh9lGc"></div>
                <div class="VfPpkd-Bz112c-J1Ukfc-LhBDec"></div><i class="google-material-icons VfPpkd-kBDsod VjEpdd"
                  aria-hidden="true">keep</i>
              </button>
              <div class="EY8ABd-OWXEXe-TAWMXe" role="tooltip" aria-hidden="true" id="ucc-17">Pin message</div>
            </span></div>
        </div>
      </div>
    </div>
  </div>
</div> */
