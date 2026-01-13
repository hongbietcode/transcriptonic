import type {
	ExtensionStatusJSON,
	TranscriptBlock,
	ChatMessage,
	MeetingSoftware,
	ExtensionMessage,
	ExtensionResponse,
	ErrorObject,
} from "./types/index";

let isZoomRunning = false;

setInterval(() => {
	// Meeting page
	const zoomUrlPattern = /^https:\/\/app\.zoom\.us\/wc\/\d+\/.+$/;
	const isZoomUrlMatching = zoomUrlPattern.test(location.href);

	// On the meeting page and main zoom function is not running, inject it
	// This won't cause multiple main zoom injections into the current meeting because when the previous meeting ends, all UI elements are gone, destroying the corresponding event listeners
	if (isZoomUrlMatching && !isZoomRunning) {
		zoom();
		isZoomRunning = true;
	}
	// Set flag to false when meetings ends and the tab navigates to a non matching URL, or simply the current URL is a non meeting URL
	if (!isZoomUrlMatching) {
		isZoomRunning = false;
	}
}, 2000);

function zoom(): void {
	//*********** GLOBAL VARIABLES **********//
	const extensionStatusJSON_bug: ExtensionStatusJSON = {
		status: 400,
		message: `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="https://github.com/hongbietcode/transcriptonic/issues" target="_blank">here</a>.`,
	};

	const reportErrorMessage = "There is a bug in TranscripTonic. Please report it at https://github.com/hongbietcode/transcriptonic/issues";
	const mutationConfig: MutationObserverInit = { childList: true, attributes: true, subtree: true, characterData: true };

	// Transcript array that holds one or more transcript blocks
	let transcript: TranscriptBlock[] = [];

	// Buffer variables to dump values, which get pushed to transcript array as transcript blocks, at defined conditions
	let personNameBuffer = "",
		transcriptTextBuffer = "",
		timestampBuffer = "";

	// Chat messages array that holds one or more chat messages of the meeting
	let chatMessages: ChatMessage[] = [];

	const meetingSoftware: MeetingSoftware = "Zoom";

	// Capture meeting start timestamp, stored in ISO format
	let meetingStartTimestamp = new Date().toISOString();
	let meetingTitle = document.title;

	// Capture invalid transcript and chatMessages DOM element error for the first time and silence for the rest of the meeting to prevent notification noise
	let isTranscriptDomErrorCaptured = false;

	// Capture meeting end to suppress any errors
	let hasMeetingEnded = false;

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
			meetingRoutines();
		} else {
			// Show downtime message as extension status is 400
			showNotification(extensionStatusJSON);
		}
	});

	function meetingRoutines(): void {
		waitForElement(document, "#webclient").then(() => {
			console.log(`Found iframe`);
			const iframe = document.querySelector("#webclient") as HTMLIFrameElement | null;

			if (iframe) {
				hasIframeLoaded(iframe).then(() => {
					console.log("Iframe loaded");
					const iframeDOM = iframe.contentDocument;

					// CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
					if (iframeDOM) {
						waitForElement(iframeDOM, "#audioOptionMenu").then(() => {
							console.log("Meeting started");
							const message: ExtensionMessage = {
								type: "new_meeting_started",
							};
							chrome.runtime.sendMessage(message, function () {});
							// Update meeting startTimestamp
							meetingStartTimestamp = new Date().toISOString();
							overWriteChromeStorage(["meetingStartTimestamp"], false);

							//*********** MEETING START ROUTINES **********//
							updateMeetingTitle();

							let transcriptObserver: MutationObserver;

							// **** REGISTER TRANSCRIPT LISTENER **** //
							// Wait for transcript node to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the captions icon is still not visible.
							waitForElement(iframeDOM, ".live-transcription-subtitle__box")
								.then((element) => {
									console.log("Found captions container");
									// CRITICAL DOM DEPENDENCY. Grab the transcript element.
									const transcriptTargetNode = element;

									if (transcriptTargetNode) {
										// Attempt to dim down the transcript
										(transcriptTargetNode as HTMLElement).style.opacity = "0.5";

										console.log("Registering mutation observer on .live-transcription-subtitle__box");

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

							// Show confirmation message from extensionStatusJSON, once observation has started, based on operation mode
							if (!isTranscriptDomErrorCaptured) {
								showNotification(extensionStatusJSON);
							}

							//*********** MEETING END ROUTINES **********//
							try {
								// CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
								const endCallElement = iframeDOM.querySelector(".footer__leave-btn-container");
								endCallElement?.firstChild?.addEventListener("click", function meetingEndRoutines() {
									endCallElement.removeEventListener("click", meetingEndRoutines);
									console.log("Meeting ended");
									// To suppress further errors
									hasMeetingEnded = true;
									if (transcriptObserver) {
										transcriptObserver.disconnect();
									}

									// Push any data in the buffer variables to the transcript array, but avoid pushing blank ones. Needed to handle one or more speaking when meeting ends.
									if (personNameBuffer !== "" && transcriptTextBuffer !== "") {
										pushBufferToTranscript();
									}
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
				});
			}
		});
	}

	//*********** CALLBACK FUNCTIONS **********//
	function transcriptMutationCallback(mutationsList: MutationRecord[]): void {
		mutationsList.forEach(async (_mutation) => {
			try {
				const iframe = document.querySelector("#webclient") as HTMLIFrameElement | null;
				const iframeDOM = iframe?.contentDocument;
				const transcriptTargetNode = iframeDOM?.querySelector(`.live-transcription-subtitle__box`);

				const currentPerson = transcriptTargetNode?.lastChild;

				if (currentPerson && currentPerson.childNodes.length > 1) {
					const currentTranscriptText = currentPerson.lastChild?.textContent;

					const currentPersonElement = currentPerson.firstChild as HTMLElement | null;
					let currentPersonName = "";

					if (currentPersonElement?.tagName === "IMG") {
						const avatarSrc = (currentPersonElement as HTMLImageElement).src;
						const avatarElements = iframeDOM?.querySelectorAll(`img[src="${avatarSrc}"]`);
						// Check if another image of same src exists on the page
						if (avatarElements && avatarElements.length > 1) {
							currentPersonName =
								iframeDOM?.querySelectorAll(`img[src="${avatarSrc}"]`)[0]?.parentElement?.nextSibling?.textContent || "";
							// Store avatarSrc and name in local storage for future meetings
							localStorage.setItem(avatarSrc, currentPersonName);
						} else {
							// Try to read if avatarSrc and name is available in local storage
							if (localStorage.getItem(avatarSrc)) {
								currentPersonName = localStorage.getItem(avatarSrc) || "";
							} else {
								currentPersonName = "Person " + (await getAvatarIdentifier(avatarSrc));
							}
						}
					} else {
						currentPersonName = currentPersonElement?.textContent || "";
					}

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
								// Update buffers for next mutation
								// Append only the new part of the transcript
								transcriptTextBuffer = transcriptTextBuffer + findNewPart(transcriptTextBuffer, currentTranscriptText);
							}
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

	//*********** HELPER FUNCTIONS **********//

	function findNewPart(string1: string, string2: string): string {
		// Scenario 1: string2 has characters added to the end.
		if (string2.startsWith(string1)) {
			return string2.substring(string1.length);
		}

		// Scenario 2: string2 has been truncated at the beginning and has a new part at the end.
		let tempString1 = string1;
		while (tempString1.length > 0) {
			if (string2.startsWith(tempString1)) {
				return string2.substring(tempString1.length);
			}
			// Chop off one character from the beginning of the temporary string for next loop iteration
			tempString1 = tempString1.substring(1);
		}

		// No common suffix and prefix between the two strings. So the second string must be entirely new.
		return string2;
	}

	async function getAvatarIdentifier(url: string | undefined): Promise<string> {
		// Check if the URL is valid
		if (!url || typeof url !== "string") {
			return "invalid_url";
		}

		try {
			// Encode the URL into a buffer
			const msgUint8 = new TextEncoder().encode(url);

			// Hash the URL using SHA-256
			const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);

			// Convert the hash buffer to a hexadecimal string
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

			// Return the first 10 characters of the hash as the identifier
			return hashHex.substring(0, 10);
		} catch (error) {
			console.error("Error hashing URL:", error);
			return "hashing_error";
		}
	}

	function hasIframeLoaded(iframe: HTMLIFrameElement): Promise<boolean> {
		return new Promise((resolve) => {
			if (iframe.contentDocument?.readyState) {
				resolve(true);
			} else {
				iframe?.addEventListener("load", () => {
					resolve(true);
				});
			}
		});
	}

	function pushBufferToTranscript(): void {
		transcript.push({
			personName: personNameBuffer,
			timestamp: timestampBuffer,
			transcriptText: transcriptTextBuffer.trim(),
		});

		overWriteChromeStorage(["transcript"], false);
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
		const iframe = document.querySelector("#webclient") as HTMLIFrameElement;
		const iframeDOM = iframe.contentDocument;

		if (iframeDOM) {
			let activityStatus = iframeDOM.querySelector<HTMLDivElement>(`#transcriptonic-status`);
			if (!activityStatus) {
				let html = iframeDOM.querySelector("html");
				activityStatus = iframeDOM.createElement("div");
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
	}

	function updateMeetingTitle(): void {
		setTimeout(() => {
			// NON CRITICAL DOM DEPENDENCY
			meetingTitle = document.title;
			overWriteChromeStorage(["meetingTitle"], false);
		}, 5000);
	}

	async function waitForElement(iframe: Document, selector: string, text?: string | RegExp): Promise<Element | null> {
		if (text) {
			// loops for every animation frame change, until the required element is found
			while (!Array.from(iframe.querySelectorAll(selector)).find((element) => element.textContent === text)) {
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
		} else {
			// loops for every animation frame change, until the required element is found
			while (!iframe.querySelector(selector)) {
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
		}
		return iframe.querySelector(selector);
	}

	function showNotification(extensionStatusJSON: ExtensionStatusJSON): void {
		const iframe = document.querySelector("#webclient") as HTMLIFrameElement;
		const iframeDOM = iframe.contentDocument;

		if (iframeDOM) {
			// Banner CSS
			let html = iframeDOM.querySelector("html");
			let obj = iframeDOM.createElement("div");
			let logo = iframeDOM.createElement("img");
			let text = iframeDOM.createElement("p");

			logo.setAttribute("src", "https://hongbietcode.github.io/transcripto-status/icon.png");
			logo.setAttribute("height", "32px");
			logo.setAttribute("width", "32px");
			logo.style.cssText = "border-radius: 4px";
			text.style.cssText = "margin-top: 1rem; margin-bottom:1rem";

			if (extensionStatusJSON.status === 200) {
				obj.style.cssText = `color: #2A9ACA; ${commonCSS}`;
				text.innerHTML = extensionStatusJSON.message;

				// Remove banner once transcript is on
				waitForElement(iframeDOM, ".live-transcription-subtitle__box").then(() => {
					obj.style.display = "none";
				});
			} else {
				obj.style.cssText = `color: orange; ${commonCSS}`;
				text.innerHTML = extensionStatusJSON.message;

				setTimeout(() => {
					obj.style.display = "none";
				}, 5000);
			}

			obj.prepend(text);
			obj.prepend(logo);
			if (html) html.append(obj);
		}
	}

	// CSS for notification
	const commonCSS = `background: rgb(255 255 255 / 100%); 
    backdrop-filter: blur(16px); 
    position: fixed;
    top: 5%; 
    left: 0; 
    right: 0; 
    margin-left: auto; 
    margin-right: auto;
    max-width: 780px;  
    z-index: 1000; 
    padding: 0rem 1rem;
    border-radius: 8px; 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    gap: 16px;  
    font-size: 1rem; 
    line-height: 1.5; 
    box-shadow: rgba(0, 0, 0, 0.16) 0px 10px 36px 0px, rgba(0, 0, 0, 0.06) 0px 0px 0px 1px;`;

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
			extensionStatusJSON = {
				status: 200,
				message: "TranscripTonic is ready <br /> <b>Please switch on Zoom captions to begin (More > Captions)</b>",
			};

			fetch("https://hongbietcode.github.io/transcripto-status/status-prod-zoom.json", { cache: "no-store" })
				.then((response) => response.json())
				.then((result: { minVersion: string; status: number; message: string }) => {
					const minVersion = result.minVersion;

					// Disable extension if version is below the min version
					if (!meetsMinVersion(chrome.runtime.getManifest().version, minVersion)) {
						extensionStatusJSON.status = 400;
						extensionStatusJSON.message = `<strong>TranscripTonic is not running</strong> <br /> Please update to v${minVersion} by following <a href="https://github.com/hongbietcode/transcriptonic/wiki/Manually-update-TranscripTonic" target="_blank">these instructions</a>`;
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
}
