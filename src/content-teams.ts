import type {
	ExtensionStatusJSON,
	TranscriptBlock,
	ChatMessage,
	MeetingSoftware,
	ExtensionMessage,
	ResultSync,
	ExtensionResponse,
	ErrorObject,
} from "./types/index";

let isTeamsInjected = false;

setInterval(() => {
	// Meeting lobby
	const isJoinButtonFound = document.querySelector("#prejoin-join-button");

	// On the meeting lobby and main teams function is not running, inject it
	// This won't cause multiple main teams injections into the current meeting because when the previous meeting ends, all UI elements are gone, destroying the corresponding event listeners
	if (isJoinButtonFound && !isTeamsInjected) {
		teams();
		isTeamsInjected = true;
	}
	// Reset flag for next meeting lobby visit
	if (!isJoinButtonFound) {
		isTeamsInjected = false;
	}
}, 2000);

function teams(): void {
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
	let transcriptTargetBuffer: HTMLElement | null;
	let personNameBuffer = "",
		transcriptTextBuffer = "",
		timestampBuffer = "";

	// Chat messages array that holds one or more chat messages of the meeting
	let chatMessages: ChatMessage[] = [];

	const meetingSoftware: MeetingSoftware = "Teams";

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
		// CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
		waitForElement("#hangup-button").then(() => {
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

			// Fire captions shortcut based on operation mode. Async operation.
			chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
				const resultSync = resultSyncUntyped as ResultSync;
				if (resultSync.operationMode === "manual") {
					console.log("Manual mode selected, leaving transcript off");
					showNotification({
						status: 400,
						message: "<strong>TranscripTonic is not running</strong> <br /> Turn on captions, if needed (More > Language > Captions)",
					});
				} else {
					// Allow keyboard event listener to be ready
					setTimeout(() => {
						dispatchLiveCaptionsShortcut();
						// Show message to enable because keyboard shortcut does not work in guest meetings
						showNotification(extensionStatusJSON);
					}, 2000);
				}
			});

			waitForElement(`.f419p8h`).then((element) => {
				// Reduce the height from 43% to 20%
				element?.setAttribute("style", "height:20%");
			});

			// **** REGISTER TRANSCRIPT LISTENER **** //
			let transcriptObserver: MutationObserver;
			// Wait for transcript node to be visible. When user is waiting in meeting lobbing for someone to let them in, the call end icon is visible, but the captions icon is still not visible.
			waitForElement(`[data-tid="closed-caption-v2-virtual-list-content"]`)
				.then((element) => {
					console.log("Found captions container");
					// CRITICAL DOM DEPENDENCY. Grab the transcript element.
					const transcriptTargetNode = element;

					if (transcriptTargetNode) {
						// Attempt to dim down the transcript
						transcriptTargetNode.setAttribute("style", "opacity:0.2");

						console.log(`Registering mutation observer on [data-tid="closed-caption-v2-virtual-list-content"]`);

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

			//*********** MEETING END ROUTINES **********//
			waitForElement(`#hangup-button`).then(() => {
				// For some reason, capturing the reference to #hangup-button immediately is not working. Need to wait for a moment.
				setTimeout(() => {
					// CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
					let endCallElement: Element | null = document.querySelector("#hangup-button");
					if (endCallElement?.nextElementSibling?.tagName === "BUTTON") {
						endCallElement = endCallElement?.parentElement;
					}
					endCallElement?.addEventListener("click", meetingEndRoutines);

					function meetingEndRoutines() {
						endCallElement?.removeEventListener("click", meetingEndRoutines);
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
					}
				}, 1000);
			});
		});
	}

	//*********** CALLBACK FUNCTIONS **********//
	function transcriptMutationCallback(mutationsList: MutationRecord[]): void {
		mutationsList.forEach(async (mutation) => {
			try {
				// const transcriptTargetNode = document.querySelector(`[data-tid="closed-caption-v2-virtual-list-content"]`)
				if (mutation.type === "characterData") {
					const mutationTarget = (mutation.target as Node).parentElement;

					const currentPersonName = mutationTarget?.parentElement?.previousSibling?.textContent;
					const currentTranscriptText = mutationTarget?.textContent;

					if (currentPersonName && currentTranscriptText) {
						// Starting fresh in a meeting
						if (!transcriptTargetBuffer) {
							transcriptTargetBuffer = mutation.target.parentElement as HTMLElement;
							personNameBuffer = currentPersonName;
							timestampBuffer = new Date().toISOString();
							transcriptTextBuffer = currentTranscriptText;
						}
						// Some prior transcript buffer exists
						else {
							// New transcript UI block
							if (transcriptTargetBuffer !== mutation.target.parentElement) {
								// Push previous transcript block
								pushBufferToTranscript();

								// Update buffers for next mutation and store transcript block timestamp
								transcriptTargetBuffer = mutation.target.parentElement as HTMLElement;
								personNameBuffer = currentPersonName;
								timestampBuffer = new Date().toISOString();
								transcriptTextBuffer = currentTranscriptText;
							}
							// Same transcript UI block being appended
							else {
								// Update buffer for next mutation
								transcriptTextBuffer = currentTranscriptText;
							}
						}
					}

					// Logs to indicate that the extension is working
					if (transcriptTextBuffer.length > 125) {
						console.log(transcriptTextBuffer.slice(0, 50) + "   ...   " + transcriptTextBuffer.slice(-50));
					} else {
						console.log(transcriptTextBuffer);
					}
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

	function pushBufferToTranscript(): void {
		transcript.push({
			personName: personNameBuffer,
			timestamp: timestampBuffer,
			transcriptText: transcriptTextBuffer,
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
		setTimeout(() => {
			// NON CRITICAL DOM DEPENDENCY
			meetingTitle = document.title;
			overWriteChromeStorage(["meetingTitle"], false);
		}, 5000);
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

	function dispatchLiveCaptionsShortcut(): void {
		let key, code, modifiers;

		// Mac: Command+Shift+A
		key = "a";
		code = "KeyA";
		modifiers = { metaKey: true, shiftKey: true, bubbles: true };

		let event = new KeyboardEvent("keydown", {
			key: key,
			code: code,
			...modifiers,
		});
		document.dispatchEvent(event);

		// Windows: Alt+Shift+C (defaulting non-Mac to Windows)
		key = "c";
		code = "KeyC";
		modifiers = { altKey: true, shiftKey: true, bubbles: true };

		event = new KeyboardEvent("keydown", {
			key: key,
			code: code,
			...modifiers,
		});
		document.dispatchEvent(event);
	}

	function showNotification(extensionStatusJSON: ExtensionStatusJSON): void {
		// Banner CSS
		let html = document.querySelector("html");
		let obj = document.createElement("div");
		let logo = document.createElement("img");
		let text = document.createElement("p");

		logo.setAttribute("src", "https://hongbietcode.github.io/transcripto-status/icon.png");
		logo.setAttribute("height", "32px");
		logo.setAttribute("width", "32px");
		logo.style.cssText = "border-radius: 4px";
		text.style.cssText = "margin-top: 1rem; margin-bottom:1rem; font-size: medium";

		if (extensionStatusJSON.status === 200) {
			obj.style.cssText = `color: #2A9ACA; ${commonCSS}`;
			text.innerHTML = extensionStatusJSON.message;

			// Remove banner once transcript is on
			waitForElement(`[data-tid="closed-caption-renderer-wrapper"]`).then(() => {
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

	// CSS for notification
	const commonCSS = `background: rgb(255 255 255 / 100%); 
    backdrop-filter: blur(16px); 
    position: fixed;
    bottom: 5%; 
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
				message: "<b>TranscripTonic is ready, enabling captions...</b> <br /> Please enable manually if not successful (More > Captions)",
			};

			// https://stackoverflow.com/a/42518434
			fetch("https://hongbietcode.github.io/transcripto-status/status-prod-teams.json", { cache: "no-store" })
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
