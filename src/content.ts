type MeetingSoftware = "Google Meet" | "Zoom" | "Teams" | "" | undefined;
type StorageKey = "meetingSoftware" | "meetingTitle" | "meetingStartTimestamp" | "transcript" | "chatMessages";

interface TranscriptEntry {
	speaker: string;
	text: string;
	timestamp: string;
}

interface TranscriptBlock {
	personName: string;
	timestamp: string;
	transcriptText: string;
}

interface ChatMessage {
	personName: string;
	timestamp: string;
	chatMessageText: string;
}

interface ExtensionStatusJSON {
	status: number;
	message: string;
}

interface ExtensionMessage {
	type: "new_meeting_started" | "meeting_ended" | "download_transcript_at_index" | "retry_webhook_at_index" | "recover_last_meeting" | "register_content_scripts";
	index?: number;
}

interface ExtensionResponse {
	success: boolean;
	message?: string | ErrorObject;
}

interface ErrorObject {
	errorCode: string;
	errorMessage: string;
}

interface ResultSync {
	autoPostWebhookAfterMeeting?: boolean;
	operationMode?: "auto" | "manual";
	webhookBodyType?: "simple" | "advanced";
	webhookUrl?: string;
}

interface IconSelector {
	selector: string;
	text: string;
}

const PANEL_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }

.panel {
	--color-bg: #1e1e1e;
	--color-primary: #1a73e8;
	--color-primary-dark: #0d47a1;
	--color-danger: #f44336;
	--color-text: #fff;
	--color-text-muted: rgba(255, 255, 255, 0.5);
	--color-text-secondary: rgba(255, 255, 255, 0.9);
	--color-accent: #8ab4f8;
	--color-border: rgba(255, 255, 255, 0.1);
	--color-surface: rgba(255, 255, 255, 0.05);
	--color-surface-hover: rgba(255, 255, 255, 0.1);
	--color-btn: rgba(255, 255, 255, 0.15);
	--color-btn-hover: rgba(255, 255, 255, 0.25);
	--radius-sm: 6px;
	--radius-md: 8px;
	--radius-lg: 12px;
	--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4);
	--font-family: "Google Sans", Roboto, -apple-system, sans-serif;
	--transition-fast: 0.2s;

	position: fixed;
	top: 60px;
	right: 12px;
	width: 340px;
	height: calc(100vh - 140px);
	max-height: 600px;
	background: var(--color-bg);
	border-radius: var(--radius-lg);
	box-shadow: var(--shadow-lg);
	font-family: var(--font-family);
	color: var(--color-text);
	display: flex;
	flex-direction: column;
	overflow: hidden;
	z-index: 9999;
	border: 1px solid var(--color-border);
}

.panel.minimized { height: auto; max-height: none; }
.panel.minimized .content,
.panel.minimized .footer { display: none; }

.header {
	padding: 12px 16px;
	background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-shrink: 0;
}

.title {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 14px;
	font-weight: 600;
}

.icon {
	color: var(--color-danger);
	animation: pulse 1.5s infinite;
	font-size: 10px;
}

@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}

.controls { display: flex; gap: 4px; }

.btn {
	background: var(--color-btn);
	border: none;
	color: var(--color-text);
	width: 28px;
	height: 28px;
	border-radius: var(--radius-sm);
	cursor: pointer;
	font-size: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background var(--transition-fast);
}
.btn:hover { background: var(--color-btn-hover); }

.content {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
	scroll-behavior: smooth;
}
.content::-webkit-scrollbar { width: 6px; }
.content::-webkit-scrollbar-track { background: transparent; }
.content::-webkit-scrollbar-thumb {
	background: rgba(255, 255, 255, 0.2);
	border-radius: 3px;
}

.entry {
	margin-bottom: 12px;
	padding: 10px 12px;
	background: var(--color-surface);
	border-radius: var(--radius-md);
	border-left: 3px solid var(--color-primary);
}
.entry.current {
	border-left-color: var(--color-danger);
	background: rgba(244, 67, 54, 0.1);
}

.entry-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 6px;
}

.speaker {
	font-weight: 600;
	color: var(--color-accent);
	font-size: 13px;
}

.time {
	font-size: 11px;
	color: var(--color-text-muted);
}

.text {
	font-size: 13px;
	line-height: 1.5;
	color: var(--color-text-secondary);
	word-wrap: break-word;
}

.footer {
	padding: 10px 16px;
	background: rgba(0, 0, 0, 0.2);
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-shrink: 0;
	border-top: 1px solid var(--color-border);
}

.count {
	font-size: 12px;
	color: var(--color-text-muted);
}

.btn-copy {
	background: var(--color-surface-hover);
	border: none;
	color: var(--color-text);
	padding: 6px 12px;
	border-radius: var(--radius-sm);
	cursor: pointer;
	font-size: 12px;
	transition: background var(--transition-fast);
}
.btn-copy:hover { background: rgba(255, 255, 255, 0.2); }
`;

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
	font-family: "Google Sans", Roboto, Arial, sans-serif;
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
	STATUS_URL: "https://raw.githubusercontent.com/hongbietcode/transcriptonic/refs/heads/main/docs/status.json",
	ERROR_LOG_URL: "https://script.google.com/macros/s/AKfycbwN-bVkVv3YX4qvrEVwG9oSup0eEd3R22kgKahsQ3bCTzlXfRuaiO7sUVzH9ONfhL4wbA/exec",
	ISSUES_URL: "https://github.com/hongbietcode/transcriptonic/issues",
	WIKI_URL: "https://github.com/hongbietcode/transcriptonic/wiki/Manually-update-TranscripTonic",
	RECOVERY_TIMEOUT: 2000,
	NOTIFICATION_DURATION: 5000,
	PULSE_DURATION: 3000,
	TITLE_UPDATE_DELAY: 7000,
	MAX_PANEL_ENTRIES: 100,
	LONG_TRANSCRIPT_THRESHOLD: -250,
} as const;

const MUTATION_CONFIG: MutationObserverInit = {
	childList: true,
	attributes: true,
	subtree: true,
	characterData: true,
};

const UI_SELECTORS = {
	v1: {
		meetingEnd: { selector: ".google-material-icons", text: "call_end" },
		captions: { selector: ".material-icons-extended", text: "closed_caption_off" },
	},
	v2: {
		meetingEnd: { selector: ".google-symbols", text: "call_end" },
		captions: { selector: ".google-symbols", text: "closed_caption_off" },
	},
	chat: { selector: ".google-symbols", text: "chat" },
	transcript: 'div[role="region"][tabindex="0"]',
	chatMessages: 'div[aria-live="polite"].Ge9Kpc',
	userName: ".awLEm",
	meetingTitle: ".u6vdEc",
} as const;

const STATUS_MESSAGES = {
	running: "<strong>TranscripTonic is running</strong> <br /> Do not turn off captions",
	manual: "<strong>TranscripTonic is not running</strong> <br /> Turn on captions using the CC icon, if needed",
	bug: `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="${CONFIG.ISSUES_URL}" target="_blank">here</a>.`,
	titlePrompt: "<b>Give this meeting a title?</b><br/>Edit the underlined text in the bottom left corner",
} as const;

class LiveTranscriptPanel {
	private hostElement: HTMLDivElement | null = null;
	private shadowRoot: ShadowRoot | null = null;
	private contentDiv: HTMLDivElement | null = null;
	private entries: TranscriptEntry[] = [];
	private isVisible = true;
	private isMinimized = false;

	create(): void {
		if (this.hostElement) return;

		this.hostElement = document.createElement("div");
		this.hostElement.id = "transcriptonic-live-panel-host";
		document.body.appendChild(this.hostElement);

		this.shadowRoot = this.hostElement.attachShadow({ mode: "closed" });
		this.shadowRoot.innerHTML = `
			<style>${PANEL_STYLES}</style>
			<div class="panel">
				<div class="header">
					<div class="title">
						<span class="icon">●</span>
						<span>Live Transcript</span>
					</div>
					<div class="controls">
						<button class="btn minimize" title="Minimize">−</button>
						<button class="btn close" title="Close">×</button>
					</div>
				</div>
				<div class="content"></div>
				<div class="footer">
					<span class="count">0 entries</span>
					<button class="btn-copy" title="Copy all">Copy</button>
				</div>
			</div>
		`;

		this.contentDiv = this.shadowRoot.querySelector(".content");
		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.querySelector(".minimize")?.addEventListener("click", () => this.toggleMinimize());
		this.shadowRoot.querySelector(".close")?.addEventListener("click", () => this.hide());
		this.shadowRoot.querySelector(".btn-copy")?.addEventListener("click", () => this.copyToClipboard());
	}

	addEntry(entry: TranscriptEntry): void {
		this.entries.push(entry);
		if (this.entries.length > CONFIG.MAX_PANEL_ENTRIES) this.entries.shift();
		this.render();
		this.scrollToBottom();
		this.updateCount();
	}

	updateCurrentSpeaker(speaker: string, text: string): void {
		if (!this.contentDiv) return;

		let currentBlock = this.shadowRoot?.querySelector(".entry.current") as HTMLDivElement;
		if (!currentBlock) {
			currentBlock = document.createElement("div");
			currentBlock.className = "entry current";
			this.contentDiv.appendChild(currentBlock);
		}

		const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
		currentBlock.innerHTML = `
			<div class="entry-header">
				<span class="speaker">${this.escapeHtml(speaker)}</span>
				<span class="time">${time}</span>
			</div>
			<div class="text">${this.escapeHtml(text)}</div>
		`;
		this.scrollToBottom();
	}

	finalizeCurrent(): void {
		this.shadowRoot?.querySelector(".entry.current")?.classList.remove("current");
	}

	private render(): void {
		if (!this.contentDiv) return;
		const currentBlock = this.shadowRoot?.querySelector(".entry.current");

		this.contentDiv.innerHTML = this.entries
			.map(
				(entry) => `
				<div class="entry">
					<div class="entry-header">
						<span class="speaker">${this.escapeHtml(entry.speaker)}</span>
						<span class="time">${this.formatTime(entry.timestamp)}</span>
					</div>
					<div class="text">${this.escapeHtml(entry.text)}</div>
				</div>
			`
			)
			.join("");

		if (currentBlock) this.contentDiv.appendChild(currentBlock);
	}

	private scrollToBottom(): void {
		if (this.contentDiv) this.contentDiv.scrollTop = this.contentDiv.scrollHeight;
	}

	private updateCount(): void {
		const countEl = this.shadowRoot?.querySelector(".count");
		if (countEl) countEl.textContent = `${this.entries.length} entries`;
	}

	private toggleMinimize(): void {
		if (!this.shadowRoot) return;
		this.isMinimized = !this.isMinimized;

		const panel = this.shadowRoot.querySelector(".panel");
		const btn = this.shadowRoot.querySelector(".minimize");

		panel?.classList.toggle("minimized", this.isMinimized);
		if (btn) btn.textContent = this.isMinimized ? "+" : "−";
	}

	private copyToClipboard(): void {
		const text = this.entries.map((e) => `[${this.formatTime(e.timestamp)}] ${e.speaker}: ${e.text}`).join("\n\n");

		navigator.clipboard.writeText(text).then(() => {
			const btn = this.shadowRoot?.querySelector(".btn-copy");
			if (btn) {
				const original = btn.textContent;
				btn.textContent = "Copied!";
				setTimeout(() => (btn.textContent = original), 1500);
			}
		});
	}

	show(): void {
		if (this.hostElement) {
			this.hostElement.style.display = "block";
			this.isVisible = true;
		}
	}

	hide(): void {
		if (this.hostElement) {
			this.hostElement.style.display = "none";
			this.isVisible = false;
		}
	}

	toggle(): void {
		this.isVisible ? this.hide() : this.show();
	}

	destroy(): void {
		this.hostElement?.remove();
		this.hostElement = null;
		this.shadowRoot = null;
		this.contentDiv = null;
		this.entries = [];
	}

	private formatTime(timestamp: string): string {
		try {
			return new Date(timestamp).toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false,
			});
		} catch {
			return timestamp;
		}
	}

	private escapeHtml(text: string): string {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}
}

let userName = "You";
let transcript: TranscriptBlock[] = [];
let personNameBuffer = "";
let transcriptTextBuffer = "";
let timestampBuffer = "";
let chatMessages: ChatMessage[] = [];
let meetingStartTimestamp = new Date().toISOString();
let meetingTitle = document.title;
let isTranscriptDomErrorCaptured = false;
let isChatMessagesDomErrorCaptured = false;
let hasMeetingStarted = false;
let hasMeetingEnded = false;
let livePanel: LiveTranscriptPanel | null = null;
let extensionStatusJSON: ExtensionStatusJSON;

const meetingSoftware: MeetingSoftware = "Google Meet";

function selectElements(selector: string, text: string | RegExp): Element[] {
	return Array.from(document.querySelectorAll(selector)).filter((el) => RegExp(text).test(el.textContent || ""));
}

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
	const text = document.createElement("p");

	container.style.cssText = `color: ${status.status === 200 ? "#2A9ACA" : "orange"}; ${NOTIFICATION_STYLES}`;
	text.innerHTML = status.message;
	container.appendChild(text);
	document.documentElement.appendChild(container);

	setTimeout(() => (container.style.display = "none"), CONFIG.NOTIFICATION_DURATION);
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
	const entry: TranscriptBlock = {
		personName: personNameBuffer === "You" ? userName : personNameBuffer,
		timestamp: timestampBuffer,
		transcriptText: transcriptTextBuffer,
	};
	transcript.push(entry);

	if (livePanel) {
		livePanel.finalizeCurrent();
		livePanel.addEntry({ speaker: entry.personName, text: entry.transcriptText, timestamp: entry.timestamp });
	}

	overWriteChromeStorage(["transcript"], false);
}

function pushUniqueChatBlock(chatBlock: ChatMessage): void {
	const exists = chatMessages.some((m) => m.personName === chatBlock.personName && m.chatMessageText === chatBlock.chatMessageText);
	if (!exists) {
		console.log(chatBlock);
		chatMessages.push(chatBlock);
		overWriteChromeStorage(["chatMessages"], false);
	}
}

function transcriptMutationCallback(mutationsList: MutationRecord[]): void {
	for (const mutation of mutationsList) {
		try {
			if (mutation.type !== "characterData") continue;

			const targetElement = (mutation.target as Node).parentElement;
			const blocks = Array.from(targetElement?.parentElement?.parentElement?.children || []);
			const isTargetBlock = blocks[blocks.length - 3] === targetElement?.parentElement;

			if (!isTargetBlock) continue;

			Array.from(blocks[blocks.length - 3].children).forEach((item) => item.setAttribute("style", "opacity:0.2"));

			const currentPerson = targetElement?.previousSibling?.textContent;
			const currentText = targetElement?.textContent;

			if (currentPerson && currentText) {
				if (transcriptTextBuffer === "") {
					personNameBuffer = currentPerson;
					timestampBuffer = new Date().toISOString();
					transcriptTextBuffer = currentText;
				} else if (personNameBuffer !== currentPerson) {
					pushBufferToTranscript();
					personNameBuffer = currentPerson;
					timestampBuffer = new Date().toISOString();
					transcriptTextBuffer = currentText;
				} else {
					if (currentText.length - transcriptTextBuffer.length < CONFIG.LONG_TRANSCRIPT_THRESHOLD) {
						pushBufferToTranscript();
						timestampBuffer = new Date().toISOString();
					}
					transcriptTextBuffer = currentText;
				}
			} else {
				console.log("No active transcript");
				if (personNameBuffer && transcriptTextBuffer) pushBufferToTranscript();
				personNameBuffer = "";
				transcriptTextBuffer = "";
			}

			if (livePanel && personNameBuffer && transcriptTextBuffer) {
				livePanel.updateCurrentSpeaker(personNameBuffer, transcriptTextBuffer);
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

function chatMessagesMutationCallback(mutationsList: MutationRecord[]): void {
	for (const _ of mutationsList) {
		try {
			const chatEl = document.querySelector(UI_SELECTORS.chatMessages);
			if (!chatEl || chatEl.children.length === 0) continue;

			const msgEl = chatEl.lastChild?.firstChild?.firstChild?.lastChild as Element | undefined;
			const personEl = msgEl?.firstChild as Element | undefined;
			const personName = personEl?.childNodes.length === 1 ? userName : personEl?.firstChild?.textContent;
			const chatText = (msgEl?.lastChild?.lastChild?.firstChild?.firstChild?.firstChild as Element | undefined)?.textContent;

			if (personName && chatText) {
				pushUniqueChatBlock({ personName, timestamp: new Date().toISOString(), chatMessageText: chatText });
			}
		} catch (err) {
			console.error(err);
			if (!isChatMessagesDomErrorCaptured && !hasMeetingEnded) {
				showNotification({ status: 400, message: STATUS_MESSAGES.bug });
				logError("006", err);
			}
			isChatMessagesDomErrorCaptured = true;
		}
	}
}

function updateMeetingTitle(): void {
	waitForElement(UI_SELECTORS.meetingTitle).then((element) => {
		const titleEl = element as HTMLDivElement;
		titleEl?.setAttribute("contenteditable", "true");
		titleEl.title = "Edit meeting title for TranscripTonic";
		titleEl.style.cssText = "text-decoration: underline white; text-underline-offset: 4px;";

		const handleChange = () => {
			meetingTitle = titleEl.innerText;
			overWriteChromeStorage(["meetingTitle"], false);
		};

		titleEl?.addEventListener("input", handleChange);

		setTimeout(() => {
			handleChange();
			if (location.pathname === `/${titleEl.innerText}`) {
				showNotification({ status: 200, message: STATUS_MESSAGES.titlePrompt });
			}
		}, CONFIG.TITLE_UPDATE_DELAY);
	});
}

async function checkExtensionStatus(): Promise<void> {
	extensionStatusJSON = { status: 200, message: STATUS_MESSAGES.running };

	try {
		const response = await fetch(CONFIG.STATUS_URL, { cache: "no-store" });
		const result = await response.json();

		if (!meetsMinVersion(chrome.runtime.getManifest().version, result.minVersion)) {
			extensionStatusJSON = {
				status: 400,
				message: `<strong>TranscripTonic is not running</strong> <br /> Please force update to v${result.minVersion} by following <a href="${CONFIG.WIKI_URL}" target="_blank">these instructions</a>`,
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

function meetingRoutines(uiVersion: 1 | 2): void {
	const selectors = uiVersion === 1 ? UI_SELECTORS.v1 : UI_SELECTORS.v2;
	const { meetingEnd, captions } = selectors;

	waitForElement(meetingEnd.selector, meetingEnd.text).then(() => {
		console.log("Meeting started");
		chrome.runtime.sendMessage({ type: "new_meeting_started" } as ExtensionMessage);

		hasMeetingStarted = true;
		meetingStartTimestamp = new Date().toISOString();
		overWriteChromeStorage(["meetingStartTimestamp"], false);

		updateMeetingTitle();

		livePanel = new LiveTranscriptPanel();
		livePanel.create();

		let transcriptObserver: MutationObserver;
		let chatMessagesObserver: MutationObserver;

		waitForElement(captions.selector, captions.text).then(() => {
			const captionsBtn = selectElements(captions.selector, captions.text)[0] as HTMLElement;

			chrome.storage.sync.get(["operationMode"], (result: ResultSync) => {
				if (result.operationMode !== "manual") captionsBtn.click();
				else console.log("Manual mode selected, leaving transcript off");
			});

			waitForElement(UI_SELECTORS.transcript)
				.then(() => {
					const transcriptNode = document.querySelector(UI_SELECTORS.transcript);
					if (!transcriptNode) throw new Error("Transcript element not found");

					transcriptObserver = new MutationObserver(transcriptMutationCallback);
					transcriptObserver.observe(transcriptNode, MUTATION_CONFIG);
				})
				.catch((err) => {
					console.error(err);
					isTranscriptDomErrorCaptured = true;
					showNotification({ status: 400, message: STATUS_MESSAGES.bug });
					logError("001", err);
				});
		});

		waitForElement(UI_SELECTORS.chat.selector, UI_SELECTORS.chat.text)
			.then(() => {
				const chatBtn = selectElements(UI_SELECTORS.chat.selector, UI_SELECTORS.chat.text)[0] as HTMLElement;
				chatBtn.click();

				waitForElement(UI_SELECTORS.chatMessages).then(() => {
					chatBtn.click();

					try {
						const chatNode = document.querySelector(UI_SELECTORS.chatMessages);
						if (!chatNode) throw new Error("Chat messages element not found");

						chatMessagesObserver = new MutationObserver(chatMessagesMutationCallback);
						chatMessagesObserver.observe(chatNode, MUTATION_CONFIG);
					} catch (err) {
						console.error(err);
						isChatMessagesDomErrorCaptured = true;
						showNotification({ status: 400, message: STATUS_MESSAGES.bug });
						logError("002", err);
					}
				});
			})
			.catch((err) => {
				console.error(err);
				isChatMessagesDomErrorCaptured = true;
				showNotification({ status: 400, message: STATUS_MESSAGES.bug });
				logError("003", err);
			});

		if (!isTranscriptDomErrorCaptured && !isChatMessagesDomErrorCaptured) {
			chrome.storage.sync.get(["operationMode"], (result: ResultSync) => {
				showNotification(result.operationMode === "manual" ? { status: 400, message: STATUS_MESSAGES.manual } : extensionStatusJSON);
			});
		}

		try {
			const endBtn = selectElements(meetingEnd.selector, meetingEnd.text)[0]?.parentElement?.parentElement;
			endBtn?.addEventListener("click", () => {
				hasMeetingEnded = true;
				transcriptObserver?.disconnect();
				chatMessagesObserver?.disconnect();

				if (personNameBuffer && transcriptTextBuffer) pushBufferToTranscript();

				livePanel?.destroy();
				livePanel = null;

				overWriteChromeStorage(["transcript", "chatMessages"], true);
			});
		} catch (err) {
			console.error(err);
			showNotification({ status: 400, message: STATUS_MESSAGES.bug });
			logError("004", err);
		}
	});
}

Promise.race([recoverLastMeeting(), new Promise<never>((_, reject) => setTimeout(() => reject({ errorCode: "016", errorMessage: "Recovery timed out" }), CONFIG.RECOVERY_TIMEOUT))])
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

	waitForElement(UI_SELECTORS.userName).then(() => {
		const interval = setInterval(() => {
			if (hasMeetingStarted) {
				clearInterval(interval);
				return;
			}

			const name = document.querySelector(UI_SELECTORS.userName)?.textContent;
			if (name) {
				userName = name;
				clearInterval(interval);
			}
		}, 100);
	});

	meetingRoutines(2);
});
