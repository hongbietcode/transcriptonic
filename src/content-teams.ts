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

type StorageKey = "meetingSoftware" | "meetingTitle" | "meetingStartTimestamp" | "transcript" | "chatMessages";

const NOTIFICATION_STYLES = `
	background: rgb(255 255 255 / 100%);
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
	box-shadow: rgba(0, 0, 0, 0.16) 0px 10px 36px 0px, rgba(0, 0, 0, 0.06) 0px 0px 0px 1px;
`;

const STATUS_BAR_STYLES = `
	position: fixed;
	top: 0px;
	width: 100%;
	height: 4px;
	z-index: 100;
	transition: background-color 0.3s ease-in;
`;

const CONFIG = {
	STATUS_URL: "https://hongbietcode.github.io/transcripto-status/status-prod-teams.json",
	ICON_URL: "https://hongbietcode.github.io/transcripto-status/icon.png",
	ERROR_LOG_URL: "https://script.google.com/macros/s/AKfycbwN-bVkVv3YX4qvrEVwG9oSup0eEd3R22kgKahsQ3bCTzlXfRuaiO7sUVzH9ONfhL4wbA/exec",
	ISSUES_URL: "https://github.com/hongbietcode/transcriptonic/issues",
	WIKI_URL: "https://github.com/hongbietcode/transcriptonic/wiki/Manually-update-TranscripTonic",
	RECOVERY_TIMEOUT: 2000,
	NOTIFICATION_DURATION: 5000,
	PULSE_DURATION: 3000,
	TITLE_UPDATE_DELAY: 5000,
	POLL_INTERVAL: 2000,
	CAPTIONS_SHORTCUT_DELAY: 2000,
	HANGUP_LISTENER_DELAY: 1000,
} as const;

const MUTATION_CONFIG: MutationObserverInit = {
	childList: true,
	attributes: true,
	subtree: true,
	characterData: true,
};

const UI_SELECTORS = {
	joinButton: "#prejoin-join-button",
	hangupButton: "#hangup-button",
	transcript: '[data-tid="closed-caption-v2-virtual-list-content"]',
	transcriptWrapper: '[data-tid="closed-caption-renderer-wrapper"]',
	captionsContainer: ".f419p8h",
} as const;

const STATUS_MESSAGES = {
	ready: "<b>TranscripTonic is ready, enabling captions...</b> <br /> Please enable manually if not successful (More > Captions)",
	manual: "<strong>TranscripTonic is not running</strong> <br /> Turn on captions, if needed (More > Language > Captions)",
	bug: `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="${CONFIG.ISSUES_URL}" target="_blank">here</a>.`,
} as const;

const meetingSoftware: MeetingSoftware = "Teams";
let isTeamsInjected = false;

setInterval(() => {
	const isJoinButtonFound = document.querySelector(UI_SELECTORS.joinButton);

	if (isJoinButtonFound && !isTeamsInjected) {
		teams();
		isTeamsInjected = true;
	}

	if (!isJoinButtonFound) {
		isTeamsInjected = false;
	}
}, CONFIG.POLL_INTERVAL);

function teams(): void {
	let transcript: TranscriptBlock[] = [];
	let transcriptTargetBuffer: HTMLElement | null = null;
	let personNameBuffer = "";
	let transcriptTextBuffer = "";
	let timestampBuffer = "";
	let chatMessages: ChatMessage[] = [];
	let meetingStartTimestamp = new Date().toISOString();
	let meetingTitle = document.title;
	let isTranscriptDomErrorCaptured = false;
	let hasMeetingEnded = false;
	let extensionStatusJSON: ExtensionStatusJSON;

	async function waitForElement(selector: string, text?: string | RegExp): Promise<Element | null> {
		const condition = text
			? () => Array.from(document.querySelectorAll(selector)).find((el) => el.textContent === text)
			: () => document.querySelector(selector);

		while (!condition()) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		return document.querySelector(selector);
	}

	function showNotification(status: ExtensionStatusJSON): void {
		const container = document.createElement("div");
		const logo = document.createElement("img");
		const text = document.createElement("p");

		logo.src = CONFIG.ICON_URL;
		logo.height = 32;
		logo.width = 32;
		logo.style.cssText = "border-radius: 4px";
		text.style.cssText = "margin-top: 1rem; margin-bottom: 1rem; font-size: medium";

		container.style.cssText = `color: ${status.status === 200 ? "#2A9ACA" : "orange"}; ${NOTIFICATION_STYLES}`;
		text.innerHTML = status.message;

		container.appendChild(logo);
		container.appendChild(text);
		document.documentElement.appendChild(container);

		if (status.status === 200) {
			waitForElement(UI_SELECTORS.transcriptWrapper).then(() => (container.style.display = "none"));
		} else {
			setTimeout(() => (container.style.display = "none"), CONFIG.NOTIFICATION_DURATION);
		}
	}

	function pulseStatus(): void {
		let statusBar = document.querySelector<HTMLDivElement>("#transcriptonic-status");

		if (!statusBar) {
			statusBar = document.createElement("div");
			statusBar.id = "transcriptonic-status";
			document.documentElement.appendChild(statusBar);
		}

		statusBar.style.cssText = `background-color: #2A9ACA; ${STATUS_BAR_STYLES}`;
		setTimeout(() => (statusBar!.style.cssText = `background-color: transparent; ${STATUS_BAR_STYLES}`), CONFIG.PULSE_DURATION);
	}

	function logError(code: string, err: unknown): void {
		const version = chrome.runtime.getManifest().version;
		const url = `${CONFIG.ERROR_LOG_URL}?version=${version}&code=${code}&error=${encodeURIComponent(String(err))}&meetingSoftware=${meetingSoftware}`;
		fetch(url, { mode: "no-cors" });
	}

	function meetsMinVersion(currentVer: string, minVer: string): boolean {
		const current = currentVer.split(".").map(Number);
		const min = minVer.split(".").map(Number);

		for (let i = 0; i < min.length; i++) {
			if (min[i] > current[i]) return false;
			if (min[i] < current[i]) return true;
		}
		return true;
	}

	function overWriteChromeStorage(keys: StorageKey[], sendDownloadMessage: boolean): void {
		const data: Record<string, unknown> = {};

		if (keys.includes("meetingSoftware")) data.meetingSoftware = meetingSoftware;
		if (keys.includes("meetingTitle")) data.meetingTitle = meetingTitle;
		if (keys.includes("meetingStartTimestamp")) data.meetingStartTimestamp = meetingStartTimestamp;
		if (keys.includes("transcript")) data.transcript = transcript;
		if (keys.includes("chatMessages")) data.chatMessages = chatMessages;

		chrome.storage.local.set(data, () => {
			pulseStatus();

			if (sendDownloadMessage) {
				chrome.runtime.sendMessage({ type: "meeting_ended" } as ExtensionMessage, (response: ExtensionResponse) => {
					if (!response.success && typeof response.message === "object" && response.message?.errorCode === "010") {
						console.error(response.message.errorMessage);
					}
				});
			}
		});
	}

	function pushBufferToTranscript(): void {
		transcript.push({
			personName: personNameBuffer,
			timestamp: timestampBuffer,
			transcriptText: transcriptTextBuffer,
		});
		overWriteChromeStorage(["transcript"], false);
	}

	function updateMeetingTitle(): void {
		setTimeout(() => {
			meetingTitle = document.title;
			overWriteChromeStorage(["meetingTitle"], false);
		}, CONFIG.TITLE_UPDATE_DELAY);
	}

	function dispatchLiveCaptionsShortcut(): void {
		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "a",
				code: "KeyA",
				metaKey: true,
				shiftKey: true,
				bubbles: true,
			})
		);

		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "c",
				code: "KeyC",
				altKey: true,
				shiftKey: true,
				bubbles: true,
			})
		);
	}

	async function checkExtensionStatus(): Promise<void> {
		extensionStatusJSON = { status: 200, message: STATUS_MESSAGES.ready };

		try {
			const response = await fetch(CONFIG.STATUS_URL, { cache: "no-store" });
			const result = await response.json();

			if (!meetsMinVersion(chrome.runtime.getManifest().version, result.minVersion)) {
				extensionStatusJSON = {
					status: 400,
					message: `<strong>TranscripTonic is not running</strong> <br /> Please update to v${result.minVersion} by following <a href="${CONFIG.WIKI_URL}" target="_blank">these instructions</a>`,
				};
			} else {
				extensionStatusJSON = { status: result.status, message: result.message };
			}
			console.log("Extension status fetched and saved");
		} catch (err) {
			console.error(err);
			logError("008", err);
		}
	}

	function recoverLastMeeting(): Promise<string> {
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({ type: "recover_last_meeting" } as ExtensionMessage, (response: ExtensionResponse) => {
				response.success ? resolve("Recovery complete") : reject(response.message);
			});
		});
	}

	function transcriptMutationCallback(mutationsList: MutationRecord[]): void {
		for (const mutation of mutationsList) {
			try {
				if (mutation.type !== "characterData") continue;

				const mutationTarget = (mutation.target as Node).parentElement;
				const currentPersonName = mutationTarget?.parentElement?.previousSibling?.textContent;
				const currentTranscriptText = mutationTarget?.textContent;

				if (currentPersonName && currentTranscriptText) {
					if (!transcriptTargetBuffer) {
						transcriptTargetBuffer = mutation.target.parentElement as HTMLElement;
						personNameBuffer = currentPersonName;
						timestampBuffer = new Date().toISOString();
						transcriptTextBuffer = currentTranscriptText;
					} else if (transcriptTargetBuffer !== mutation.target.parentElement) {
						pushBufferToTranscript();
						transcriptTargetBuffer = mutation.target.parentElement as HTMLElement;
						personNameBuffer = currentPersonName;
						timestampBuffer = new Date().toISOString();
						transcriptTextBuffer = currentTranscriptText;
					} else {
						transcriptTextBuffer = currentTranscriptText;
					}
				}

				if (transcriptTextBuffer.length > 125) {
					console.log(transcriptTextBuffer.slice(0, 50) + "   ...   " + transcriptTextBuffer.slice(-50));
				} else {
					console.log(transcriptTextBuffer);
				}
			} catch (err) {
				console.error(err);
				if (!isTranscriptDomErrorCaptured && !hasMeetingEnded) {
					showNotification({ status: 400, message: STATUS_MESSAGES.bug });
					logError("005", err);
				}
				isTranscriptDomErrorCaptured = true;
			}
		}
	}

	function meetingRoutines(): void {
		waitForElement(UI_SELECTORS.hangupButton).then(() => {
			console.log("Meeting started");
			chrome.runtime.sendMessage({ type: "new_meeting_started" } as ExtensionMessage);

			meetingStartTimestamp = new Date().toISOString();
			overWriteChromeStorage(["meetingStartTimestamp"], false);
			updateMeetingTitle();

			chrome.storage.sync.get(["operationMode"], (result: ResultSync) => {
				if (result.operationMode === "manual") {
					console.log("Manual mode selected, leaving transcript off");
					showNotification({ status: 400, message: STATUS_MESSAGES.manual });
				} else {
					setTimeout(() => {
						dispatchLiveCaptionsShortcut();
						showNotification(extensionStatusJSON);
					}, CONFIG.CAPTIONS_SHORTCUT_DELAY);
				}
			});

			waitForElement(UI_SELECTORS.captionsContainer).then((element) => {
				element?.setAttribute("style", "height:20%");
			});

			let transcriptObserver: MutationObserver;

			waitForElement(UI_SELECTORS.transcript)
				.then((element) => {
					console.log("Found captions container");
					if (!element) throw new Error("Transcript element not found in DOM");

					element.setAttribute("style", "opacity:0.2");
					console.log('Registering mutation observer on [data-tid="closed-caption-v2-virtual-list-content"]');

					transcriptObserver = new MutationObserver(transcriptMutationCallback);
					transcriptObserver.observe(element, MUTATION_CONFIG);
				})
				.catch((err) => {
					console.error(err);
					isTranscriptDomErrorCaptured = true;
					showNotification({ status: 400, message: STATUS_MESSAGES.bug });
					logError("001", err);
				});

			waitForElement(UI_SELECTORS.hangupButton).then(() => {
				setTimeout(() => {
					let endCallElement: Element | null = document.querySelector(UI_SELECTORS.hangupButton);

					if (endCallElement?.nextElementSibling?.tagName === "BUTTON") {
						endCallElement = endCallElement.parentElement;
					}

					const meetingEndRoutines = () => {
						endCallElement?.removeEventListener("click", meetingEndRoutines);
						console.log("Meeting ended");

						hasMeetingEnded = true;
						transcriptObserver?.disconnect();

						if (personNameBuffer && transcriptTextBuffer) {
							pushBufferToTranscript();
						}

						overWriteChromeStorage(["transcript", "chatMessages"], true);
					};

					endCallElement?.addEventListener("click", meetingEndRoutines);
				}, CONFIG.HANGUP_LISTENER_DELAY);
			});
		});
	}

	Promise.race([
		recoverLastMeeting(),
		new Promise<never>((_, reject) => setTimeout(() => reject({ errorCode: "016", errorMessage: "Recovery timed out" }), CONFIG.RECOVERY_TIMEOUT)),
	])
		.catch((err: ErrorObject) => {
			if (err.errorCode !== "013" && err.errorCode !== "014") console.error(err.errorMessage);
		})
		.finally(() => {
			overWriteChromeStorage(["meetingSoftware", "meetingStartTimestamp", "meetingTitle", "transcript", "chatMessages"], false);
		});

	checkExtensionStatus().finally(() => {
		console.log("Extension status " + extensionStatusJSON.status);

		if (extensionStatusJSON.status !== 200) {
			showNotification(extensionStatusJSON);
			return;
		}

		meetingRoutines();
	});
}
