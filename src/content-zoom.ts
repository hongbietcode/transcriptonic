import type {
	ExtensionStatusJSON,
	TranscriptBlock,
	ChatMessage,
	MeetingSoftware,
	ExtensionMessage,
	ExtensionResponse,
	ErrorObject,
} from "./types/index";

type StorageKey = "meetingSoftware" | "meetingTitle" | "meetingStartTimestamp" | "transcript" | "chatMessages";

const NOTIFICATION_STYLES = `
	background: rgb(255 255 255 / 100%);
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
	STATUS_URL: "https://hongbietcode.github.io/transcripto-status/status-prod-zoom.json",
	ICON_URL: "https://hongbietcode.github.io/transcripto-status/icon.png",
	ERROR_LOG_URL: "https://script.google.com/macros/s/AKfycbwN-bVkVv3YX4qvrEVwG9oSup0eEd3R22kgKahsQ3bCTzlXfRuaiO7sUVzH9ONfhL4wbA/exec",
	ISSUES_URL: "https://github.com/hongbietcode/transcriptonic/issues",
	WIKI_URL: "https://github.com/hongbietcode/transcriptonic/wiki/Manually-update-TranscripTonic",
	RECOVERY_TIMEOUT: 2000,
	NOTIFICATION_DURATION: 5000,
	PULSE_DURATION: 3000,
	TITLE_UPDATE_DELAY: 5000,
	POLL_INTERVAL: 2000,
	URL_PATTERN: /^https:\/\/app\.zoom\.us\/wc\/\d+\/.+$/,
} as const;

const MUTATION_CONFIG: MutationObserverInit = {
	childList: true,
	attributes: true,
	subtree: true,
	characterData: true,
};

const UI_SELECTORS = {
	iframe: "#webclient",
	audioMenu: "#audioOptionMenu",
	transcript: ".live-transcription-subtitle__box",
	leaveBtn: ".footer__leave-btn-container",
} as const;

const STATUS_MESSAGES = {
	ready: "TranscripTonic is ready <br /> <b>Please switch on Zoom captions to begin (More > Captions)</b>",
	bug: `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="${CONFIG.ISSUES_URL}" target="_blank">here</a>.`,
} as const;

const meetingSoftware: MeetingSoftware = "Zoom";
let isZoomRunning = false;

setInterval(() => {
	const isZoomUrlMatching = CONFIG.URL_PATTERN.test(location.href);

	if (isZoomUrlMatching && !isZoomRunning) {
		zoom();
		isZoomRunning = true;
	}

	if (!isZoomUrlMatching) {
		isZoomRunning = false;
	}
}, CONFIG.POLL_INTERVAL);

function zoom(): void {
	let transcript: TranscriptBlock[] = [];
	let personNameBuffer = "";
	let transcriptTextBuffer = "";
	let timestampBuffer = "";
	let chatMessages: ChatMessage[] = [];
	let meetingStartTimestamp = new Date().toISOString();
	let meetingTitle = document.title;
	let isTranscriptDomErrorCaptured = false;
	let hasMeetingEnded = false;
	let extensionStatusJSON: ExtensionStatusJSON;

	async function waitForElement(doc: Document, selector: string, text?: string | RegExp): Promise<Element | null> {
		const condition = text
			? () => Array.from(doc.querySelectorAll(selector)).find((el) => el.textContent === text)
			: () => doc.querySelector(selector);

		while (!condition()) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}
		return doc.querySelector(selector);
	}

	function hasIframeLoaded(iframe: HTMLIFrameElement): Promise<boolean> {
		return new Promise((resolve) => {
			if (iframe.contentDocument?.readyState) {
				resolve(true);
			} else {
				iframe.addEventListener("load", () => resolve(true));
			}
		});
	}

	function getIframeDOM(): Document | null {
		const iframe = document.querySelector(UI_SELECTORS.iframe) as HTMLIFrameElement | null;
		return iframe?.contentDocument || null;
	}

	function showNotification(status: ExtensionStatusJSON): void {
		const iframeDOM = getIframeDOM();
		if (!iframeDOM) return;

		const container = document.createElement("div");
		const logo = document.createElement("img");
		const text = document.createElement("p");

		logo.src = CONFIG.ICON_URL;
		logo.height = 32;
		logo.width = 32;
		logo.style.cssText = "border-radius: 4px";
		text.style.cssText = "margin-top: 1rem; margin-bottom: 1rem";

		container.style.cssText = `color: ${status.status === 200 ? "#2A9ACA" : "orange"}; ${NOTIFICATION_STYLES}`;
		text.innerHTML = status.message;

		container.appendChild(logo);
		container.appendChild(text);
		iframeDOM.documentElement.appendChild(container);

		if (status.status === 200) {
			waitForElement(iframeDOM, UI_SELECTORS.transcript).then(() => (container.style.display = "none"));
		} else {
			setTimeout(() => (container.style.display = "none"), CONFIG.NOTIFICATION_DURATION);
		}
	}

	function pulseStatus(): void {
		const iframeDOM = getIframeDOM();
		if (!iframeDOM) return;

		let statusBar = iframeDOM.querySelector<HTMLDivElement>("#transcriptonic-status");

		if (!statusBar) {
			statusBar = iframeDOM.createElement("div");
			statusBar.id = "transcriptonic-status";
			iframeDOM.documentElement.appendChild(statusBar);
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
			transcriptText: transcriptTextBuffer.trim(),
		});
		overWriteChromeStorage(["transcript"], false);
	}

	function findNewPart(str1: string, str2: string): string {
		if (str2.startsWith(str1)) {
			return str2.substring(str1.length);
		}

		let temp = str1;
		while (temp.length > 0) {
			if (str2.startsWith(temp)) {
				return str2.substring(temp.length);
			}
			temp = temp.substring(1);
		}

		return str2;
	}

	async function getAvatarIdentifier(url: string | undefined): Promise<string> {
		if (!url || typeof url !== "string") return "invalid_url";

		try {
			const msgUint8 = new TextEncoder().encode(url);
			const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
			return hashHex.substring(0, 10);
		} catch {
			return "hashing_error";
		}
	}

	function updateMeetingTitle(): void {
		setTimeout(() => {
			meetingTitle = document.title;
			overWriteChromeStorage(["meetingTitle"], false);
		}, CONFIG.TITLE_UPDATE_DELAY);
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
		mutationsList.forEach(async () => {
			try {
				const iframeDOM = getIframeDOM();
				const transcriptNode = iframeDOM?.querySelector(UI_SELECTORS.transcript);
				const currentPerson = transcriptNode?.lastChild;

				if (currentPerson && currentPerson.childNodes.length > 1) {
					const currentText = currentPerson.lastChild?.textContent;
					const personElement = currentPerson.firstChild as HTMLElement | null;
					let currentName = "";

					if (personElement?.tagName === "IMG") {
						const avatarSrc = (personElement as HTMLImageElement).src;
						const avatarElements = iframeDOM?.querySelectorAll(`img[src="${avatarSrc}"]`);

						if (avatarElements && avatarElements.length > 1) {
							currentName = iframeDOM?.querySelectorAll(`img[src="${avatarSrc}"]`)[0]?.parentElement?.nextSibling?.textContent || "";
							localStorage.setItem(avatarSrc, currentName);
						} else {
							currentName = localStorage.getItem(avatarSrc) || "Person " + (await getAvatarIdentifier(avatarSrc));
						}
					} else {
						currentName = personElement?.textContent || "";
					}

					if (currentName && currentText) {
						if (transcriptTextBuffer === "") {
							personNameBuffer = currentName;
							timestampBuffer = new Date().toISOString();
							transcriptTextBuffer = currentText;
						} else if (personNameBuffer !== currentName) {
							pushBufferToTranscript();
							personNameBuffer = currentName;
							timestampBuffer = new Date().toISOString();
							transcriptTextBuffer = currentText;
						} else {
							transcriptTextBuffer = transcriptTextBuffer + findNewPart(transcriptTextBuffer, currentText);
						}
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
		});
	}

	function meetingRoutines(): void {
		waitForElement(document, UI_SELECTORS.iframe).then(() => {
			console.log("Found iframe");
			const iframe = document.querySelector(UI_SELECTORS.iframe) as HTMLIFrameElement | null;

			if (!iframe) return;

			hasIframeLoaded(iframe).then(() => {
				console.log("Iframe loaded");
				const iframeDOM = iframe.contentDocument;
				if (!iframeDOM) return;

				waitForElement(iframeDOM, UI_SELECTORS.audioMenu).then(() => {
					console.log("Meeting started");
					chrome.runtime.sendMessage({ type: "new_meeting_started" } as ExtensionMessage);

					meetingStartTimestamp = new Date().toISOString();
					overWriteChromeStorage(["meetingStartTimestamp"], false);
					updateMeetingTitle();

					let transcriptObserver: MutationObserver;

					waitForElement(iframeDOM, UI_SELECTORS.transcript)
						.then((element) => {
							console.log("Found captions container");
							if (!element) throw new Error("Transcript element not found in DOM");

							(element as HTMLElement).style.opacity = "0.5";
							console.log("Registering mutation observer on .live-transcription-subtitle__box");

							transcriptObserver = new MutationObserver(transcriptMutationCallback);
							transcriptObserver.observe(element, MUTATION_CONFIG);
						})
						.catch((err) => {
							console.error(err);
							isTranscriptDomErrorCaptured = true;
							showNotification({ status: 400, message: STATUS_MESSAGES.bug });
							logError("001", err);
						});

					if (!isTranscriptDomErrorCaptured) {
						showNotification(extensionStatusJSON);
					}

					try {
						const endCallElement = iframeDOM.querySelector(UI_SELECTORS.leaveBtn);

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

						endCallElement?.firstChild?.addEventListener("click", meetingEndRoutines);
					} catch (err) {
						console.error(err);
						showNotification({ status: 400, message: STATUS_MESSAGES.bug });
						logError("004", err);
					}
				});
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
