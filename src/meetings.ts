import type {
	ExtensionMessage,
	ResultSync,
	ExtensionResponse,
	ResultLocal,
	Meeting,
	StreamingMessage,
	TranscriptBlock,
	MeetingInfo,
	PortMessage,
} from "./types/index";

interface LiveTranscriptEntry {
	personName: string;
	timestamp: string;
	transcriptText: string;
}

let currentView: "live" | "history" = "live";
let selectedMeetingIndex: number | null = null;
let liveTranscript: LiveTranscriptEntry[] = [];
let isLive = false;
let searchQuery = "";
let port: chrome.runtime.Port | null = null;

const timeFormat: Intl.DateTimeFormatOptions = {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
};

document.addEventListener("DOMContentLoaded", () => {
	initializePort();
	loadSettings();
	loadMeetingsHistory();
	setupEventListeners();
	setVersion();
});

function initializePort(): void {
	port = chrome.runtime.connect({ name: "transcript-stream" });
	port.postMessage({ type: "subscribe", source: "meetings_page" } as PortMessage);

	port.onMessage.addListener((msg: StreamingMessage) => {
		switch (msg.type) {
			case "meeting_started":
				handleMeetingStarted();
				break;
			case "meeting_info":
				handleMeetingInfo(msg.data as MeetingInfo);
				break;
			case "transcript_entry":
				handleTranscriptEntry(msg.data as TranscriptBlock);
				break;
			case "meeting_ended":
				handleMeetingEnded();
				break;
		}
	});

	port.onDisconnect.addListener(() => {
		setTimeout(initializePort, 1000);
	});
}

function handleMeetingStarted(): void {
	isLive = true;
	liveTranscript = [];
	currentView = "live";
	updateStatusIndicator(true);
	updateNavigation();
	renderTranscript();
}

function handleMeetingInfo(info: MeetingInfo): void {
	const titleEl = document.getElementById("meeting-title");
	const softwareEl = document.getElementById("meeting-software");
	const timeEl = document.getElementById("meeting-time");

	if (titleEl) titleEl.textContent = info.meetingTitle || "Active Meeting";
	if (softwareEl) softwareEl.textContent = info.meetingSoftware || "—";
	if (timeEl) timeEl.textContent = new Date(info.meetingStartTimestamp).toLocaleTimeString("en-US", timeFormat);
}

function handleTranscriptEntry(entry: TranscriptBlock): void {
	// Check if this is an update to the last entry (same person, recent timestamp)
	const lastEntry = liveTranscript[liveTranscript.length - 1];
	const isSameSpeaker = lastEntry && lastEntry.personName === entry.personName;
	const timeDiff = lastEntry ? new Date(entry.timestamp).getTime() - new Date(lastEntry.timestamp).getTime() : Infinity;
	const isRecentUpdate = timeDiff < 5000; // Within 5 seconds

	if (isSameSpeaker && isRecentUpdate) {
		// Update existing entry
		liveTranscript[liveTranscript.length - 1] = {
			personName: entry.personName,
			timestamp: entry.timestamp,
			transcriptText: entry.transcriptText,
		};

		if (currentView === "live") {
			// Update last entry in UI
			updateLastTranscriptEntry(entry);
		}
	} else {
		// New entry
		liveTranscript.push({
			personName: entry.personName,
			timestamp: entry.timestamp,
			transcriptText: entry.transcriptText,
		});

		if (currentView === "live") {
			appendTranscriptEntry(entry);
		} else {
		}
	}

}

function handleMeetingEnded(): void {
	isLive = false;
	updateStatusIndicator(false);
	loadMeetingsHistory();
}

function updateStatusIndicator(live: boolean): void {
	const indicator = document.getElementById("status-indicator");
	if (!indicator) return;

	if (live) {
		indicator.className = "status-indicator live";
		indicator.innerHTML = "<span>Live</span>";
	} else {
		indicator.className = "status-indicator offline";
		indicator.innerHTML = "<span>Offline</span>";
	}
}

function updateNavigation(): void {
	const navLive = document.getElementById("nav-live");
	const meetingItems = document.querySelectorAll(".meeting-item");

	navLive?.classList.toggle("active", currentView === "live");
	meetingItems.forEach((item) => {
		const index = parseInt(item.getAttribute("data-index") || "-1");
		item.classList.toggle("active", currentView === "history" && index === selectedMeetingIndex);
	});
}

function renderTranscript(): void {
	const container = document.getElementById("transcript-list");
	const emptyState = document.getElementById("empty-state");
	if (!container) return;

	const entries = currentView === "live" ? liveTranscript : getSelectedMeetingTranscript();
	const filteredEntries = filterEntries(entries);

	if (filteredEntries.length === 0) {
		container.innerHTML = "";
		if (emptyState) {
			emptyState.style.display = "flex";
			container.appendChild(emptyState);
		}
		return;
	}

	if (emptyState) emptyState.style.display = "none";

	container.innerHTML = filteredEntries
		.map((entry) => createTranscriptEntryHTML(entry))
		.join("");

	container.scrollTop = container.scrollHeight;
}

function appendTranscriptEntry(entry: LiveTranscriptEntry): void {
	const container = document.getElementById("transcript-list");
	const emptyState = document.getElementById("empty-state");
	if (!container) return;

	if (emptyState) emptyState.style.display = "none";

	if (searchQuery && !matchesSearch(entry)) return;

	const div = document.createElement("div");
	div.innerHTML = createTranscriptEntryHTML(entry);
	container.appendChild(div.firstElementChild!);
	container.scrollTop = container.scrollHeight;
}

function updateLastTranscriptEntry(entry: LiveTranscriptEntry): void {
	const container = document.getElementById("transcript-list");
	if (!container) return;

	const entries = container.querySelectorAll(".transcript-entry");
	if (entries.length === 0) return;

	const lastEntry = entries[entries.length - 1];

	// Update text content
	const textEl = lastEntry.querySelector(".transcript-text");
	if (textEl) {
		const highlightedText = highlightSearch(escapeHtml(entry.transcriptText));
		textEl.innerHTML = highlightedText;
	}

	// Keep scroll at bottom
	container.scrollTop = container.scrollHeight;
}

function createTranscriptEntryHTML(entry: LiveTranscriptEntry): string {
	const initials = getInitials(entry.personName);
	const time = new Date(entry.timestamp).toLocaleTimeString("en-US", timeFormat);
	const text = highlightSearch(escapeHtml(entry.transcriptText));

	return `
		<div class="transcript-entry">
			<div class="speaker-avatar">${initials}</div>
			<div class="transcript-content">
				<div class="transcript-header">
					<span class="speaker-name">${escapeHtml(entry.personName)}</span>
					<span class="transcript-time">${time}</span>
				</div>
				<div class="transcript-text">${text}</div>
			</div>
		</div>
	`;
}

function getSelectedMeetingTranscript(): LiveTranscriptEntry[] {
	if (selectedMeetingIndex === null) return [];

	return new Promise<LiveTranscriptEntry[]>((resolve) => {
		chrome.storage.local.get(["meetings"], (result: ResultLocal) => {
			const meetings = result.meetings || [];
			const meeting = meetings[selectedMeetingIndex!];
			if (meeting?.transcript) {
				resolve(meeting.transcript.map((t) => ({
					personName: t.personName,
					timestamp: t.timestamp,
					transcriptText: t.transcriptText,
				})));
			} else {
				resolve([]);
			}
		});
	}) as unknown as LiveTranscriptEntry[];
}

function filterEntries(entries: LiveTranscriptEntry[]): LiveTranscriptEntry[] {
	if (!searchQuery) return entries;
	return entries.filter(matchesSearch);
}

function matchesSearch(entry: LiveTranscriptEntry): boolean {
	const query = searchQuery.toLowerCase();
	return (
		entry.personName.toLowerCase().includes(query) ||
		entry.transcriptText.toLowerCase().includes(query)
	);
}

function highlightSearch(text: string): string {
	if (!searchQuery) return text;
	const regex = new RegExp(`(${escapeRegex(searchQuery)})`, "gi");
	return text.replace(regex, "<mark>$1</mark>");
}

function getInitials(name: string): string {
	return name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

function escapeHtml(text: string): string {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadMeetingsHistory(): void {
	const listContainer = document.getElementById("meetings-list");
	if (!listContainer) return;

	chrome.storage.local.get(["meetings"], (result: ResultLocal) => {
		const meetings = result.meetings || [];
		listContainer.innerHTML = "";

		if (meetings.length === 0) {
			listContainer.innerHTML = `<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">No meetings yet</div>`;
			return;
		}

		for (let i = meetings.length - 1; i >= 0; i--) {
			const meeting = meetings[i];
			const item = createMeetingItem(meeting, i);
			listContainer.appendChild(item);
		}
	});
}

function createMeetingItem(meeting: Meeting, index: number): HTMLElement {
	const div = document.createElement("div");
	div.className = "meeting-item";
	div.setAttribute("data-index", String(index));

	const date = new Date(meeting.meetingStartTimestamp);
	const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	const title = meeting.meetingTitle || meeting.title || "Meeting";

	div.innerHTML = `
		<div class="meeting-icon">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
				<polyline points="14 2 14 8 20 8"/>
			</svg>
		</div>
		<div class="meeting-details">
			<div class="meeting-name">${escapeHtml(title)}</div>
			<div class="meeting-date">${dateStr}</div>
		</div>
		<div class="meeting-actions">
			<button class="meeting-action download" title="Download">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
					<polyline points="7 10 12 15 17 10"/>
					<line x1="12" y1="15" x2="12" y2="3"/>
				</svg>
			</button>
			<button class="meeting-action delete" title="Delete">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="3 6 5 6 21 6"/>
					<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
				</svg>
			</button>
		</div>
	`;

	div.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest(".meeting-action")) return;
		selectMeeting(index, meeting);
	});

	div.querySelector(".download")?.addEventListener("click", () => downloadMeeting(index));
	div.querySelector(".delete")?.addEventListener("click", () => deleteMeeting(index));

	return div;
}

function selectMeeting(index: number, meeting: Meeting): void {
	currentView = "history";
	selectedMeetingIndex = index;
	updateNavigation();

	const titleEl = document.getElementById("meeting-title");
	const softwareEl = document.getElementById("meeting-software");
	const timeEl = document.getElementById("meeting-time");

	if (titleEl) titleEl.textContent = meeting.meetingTitle || meeting.title || "Meeting";
	if (softwareEl) softwareEl.textContent = meeting.meetingSoftware || "—";
	if (timeEl) {
		const duration = getDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp);
		timeEl.textContent = duration;
	}

	chrome.storage.local.get(["meetings"], (result: ResultLocal) => {
		const meetings = result.meetings || [];
		const selectedMeeting = meetings[index];
		if (selectedMeeting?.transcript) {
			const container = document.getElementById("transcript-list");
			const emptyState = document.getElementById("empty-state");
			if (!container) return;

			const entries = selectedMeeting.transcript.map((t) => ({
				personName: t.personName,
				timestamp: t.timestamp,
				transcriptText: t.transcriptText,
			}));

			if (entries.length === 0) {
				container.innerHTML = "";
				if (emptyState) {
					emptyState.style.display = "flex";
					container.appendChild(emptyState);
				}
				return;
			}

			if (emptyState) emptyState.style.display = "none";
			container.innerHTML = entries.map((e) => createTranscriptEntryHTML(e)).join("");
		}
	});
}

function downloadMeeting(index: number): void {
	chrome.runtime.sendMessage({ type: "download_transcript_at_index", index } as ExtensionMessage, (response: ExtensionResponse) => {
		if (response.success) {
			showToast("Transcript downloaded", "success");
		} else {
			showToast("Failed to download", "error");
		}
	});
}

function deleteMeeting(index: number): void {
	if (!confirm("Delete this meeting?")) return;

	chrome.storage.local.get(["meetings"], (result: ResultLocal) => {
		const meetings = result.meetings || [];
		meetings.splice(index, 1);
		chrome.storage.local.set({ meetings }, () => {
			loadMeetingsHistory();
			if (selectedMeetingIndex === index) {
				currentView = "live";
				selectedMeetingIndex = null;
				updateNavigation();
				renderTranscript();
			}
			showToast("Meeting deleted", "success");
		});
	});
}

function getDuration(start: string, end: string): string {
	const duration = new Date(end).getTime() - new Date(start).getTime();
	const minutes = Math.round(duration / (1000 * 60));
	const hours = Math.floor(minutes / 60);
	const remaining = minutes % 60;
	return hours > 0 ? `${hours}h ${remaining}m` : `${minutes}m`;
}

function loadSettings(): void {
	chrome.storage.sync.get(["webhookUrl", "autoPostWebhookAfterMeeting", "webhookBodyType", "operationMode"], (result: ResultSync) => {
		const webhookInput = document.getElementById("webhook-url") as HTMLInputElement;
		const quickWebhookInput = document.getElementById("quick-webhook-url") as HTMLInputElement;
		const quickSetup = document.getElementById("quick-setup");
		const autoPostCheckbox = document.getElementById("auto-post-webhook") as HTMLInputElement;
		const simpleRadio = document.querySelector('input[name="webhook-body"][value="simple"]') as HTMLInputElement;
		const advancedRadio = document.querySelector('input[name="webhook-body"][value="advanced"]') as HTMLInputElement;
		const autoModeRadio = document.querySelector('input[name="operation-mode"][value="auto"]') as HTMLInputElement;
		const manualModeRadio = document.querySelector('input[name="operation-mode"][value="manual"]') as HTMLInputElement;

		if (webhookInput && result.webhookUrl) webhookInput.value = result.webhookUrl;
		if (quickWebhookInput && result.webhookUrl) quickWebhookInput.value = result.webhookUrl;
		if (quickSetup) quickSetup.classList.toggle("hidden", !!result.webhookUrl);
		if (autoPostCheckbox) autoPostCheckbox.checked = result.autoPostWebhookAfterMeeting ?? true;
		if (result.webhookBodyType === "advanced") {
			if (advancedRadio) advancedRadio.checked = true;
		} else {
			if (simpleRadio) simpleRadio.checked = true;
		}
		if (result.operationMode === "manual") {
			if (manualModeRadio) manualModeRadio.checked = true;
		} else {
			if (autoModeRadio) autoModeRadio.checked = true;
		}
	});
}

function setupEventListeners(): void {
	const navLive = document.getElementById("nav-live");
	const searchInput = document.getElementById("search-input") as HTMLInputElement;
	const settingsBtn = document.getElementById("settings-btn");
	const settingsClose = document.getElementById("settings-close");
	const settingsPanel = document.getElementById("settings-panel");
	const exportBtn = document.getElementById("export-btn");
	const exportMenu = document.getElementById("export-menu");
	const exportTxt = document.getElementById("export-txt");
	const exportJson = document.getElementById("export-json");
	const saveWebhook = document.getElementById("save-webhook");
	const quickSaveWebhook = document.getElementById("quick-save-webhook");
	const autoPostCheckbox = document.getElementById("auto-post-webhook") as HTMLInputElement;
	const webhookBodyRadios = document.querySelectorAll('input[name="webhook-body"]');
	const operationModeRadios = document.querySelectorAll('input[name="operation-mode"]');

	navLive?.addEventListener("click", () => {
		currentView = "live";
		selectedMeetingIndex = null;
		updateNavigation();

		const titleEl = document.getElementById("meeting-title");
		const softwareEl = document.getElementById("meeting-software");
		const timeEl = document.getElementById("meeting-time");

		if (isLive) {
			renderTranscript();
		} else {
			if (titleEl) titleEl.textContent = "No Active Meeting";
			if (softwareEl) softwareEl.textContent = "—";
			if (timeEl) timeEl.textContent = "—";
			renderTranscript();
		}
	});

	searchInput?.addEventListener("input", () => {
		searchQuery = searchInput.value;
		renderTranscript();
	});

	settingsBtn?.addEventListener("click", () => {
		settingsPanel?.classList.toggle("visible");
	});

	settingsClose?.addEventListener("click", () => {
		settingsPanel?.classList.remove("visible");
	});

	exportBtn?.addEventListener("click", () => {
		exportMenu?.classList.toggle("visible");
	});

	document.addEventListener("click", (e) => {
		if (!exportBtn?.contains(e.target as Node) && !exportMenu?.contains(e.target as Node)) {
			exportMenu?.classList.remove("visible");
		}
	});

	exportTxt?.addEventListener("click", () => exportAsText());
	exportJson?.addEventListener("click", () => exportAsJson());

	saveWebhook?.addEventListener("click", () => saveWebhookUrl("webhook-url"));
	quickSaveWebhook?.addEventListener("click", () => saveWebhookUrl("quick-webhook-url"));

	autoPostCheckbox?.addEventListener("change", () => {
		chrome.storage.sync.set({ autoPostWebhookAfterMeeting: autoPostCheckbox.checked });
	});

	webhookBodyRadios.forEach((radio) => {
		radio.addEventListener("change", () => {
			const value = (radio as HTMLInputElement).value;
			chrome.storage.sync.set({ webhookBodyType: value });
		});
	});

	operationModeRadios.forEach((radio) => {
		radio.addEventListener("change", () => {
			const value = (radio as HTMLInputElement).value;
			chrome.storage.sync.set({ operationMode: value });
		});
	});

	chrome.storage.onChanged.addListener(() => {
		loadMeetingsHistory();
	});
}

function exportAsText(): void {
	const entries = currentView === "live" ? liveTranscript : [];

	if (currentView === "history" && selectedMeetingIndex !== null) {
		chrome.storage.local.get(["meetings"], (result: ResultLocal) => {
			const meetings = result.meetings || [];
			const meeting = meetings[selectedMeetingIndex!];
			if (meeting?.transcript) {
				const text = meeting.transcript
					.map((t) => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.personName}: ${t.transcriptText}`)
					.join("\n\n");
				downloadFile(text, "transcript.txt", "text/plain");
			}
		});
		return;
	}

	const text = entries
		.map((e) => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.personName}: ${e.transcriptText}`)
		.join("\n\n");
	downloadFile(text, "transcript.txt", "text/plain");
}

function exportAsJson(): void {
	if (currentView === "history" && selectedMeetingIndex !== null) {
		chrome.storage.local.get(["meetings"], (result: ResultLocal) => {
			const meetings = result.meetings || [];
			const meeting = meetings[selectedMeetingIndex!];
			if (meeting) {
				downloadFile(JSON.stringify(meeting, null, 2), "transcript.json", "application/json");
			}
		});
		return;
	}

	const data = { transcript: liveTranscript };
	downloadFile(JSON.stringify(data, null, 2), "transcript.json", "application/json");
}

function downloadFile(content: string, filename: string, type: string): void {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function saveWebhookUrl(inputId: string): void {
	const webhookInput = document.getElementById(inputId) as HTMLInputElement;
	const url = webhookInput?.value;

	if (!url) {
		chrome.storage.sync.set({ webhookUrl: "" }, () => {
			showToast("Webhook cleared", "success");
			loadSettings();
		});
		return;
	}

	try {
		const urlObj = new URL(url);
		const originPattern = `${urlObj.protocol}//${urlObj.hostname}/*`;

		chrome.permissions.request({ origins: [originPattern], permissions: ["notifications"] }, (granted) => {
			if (granted) {
				chrome.storage.sync.set({ webhookUrl: url }, () => {
					showToast("Webhook saved", "success");
					loadSettings();
				});
			} else {
				showToast("Permission denied", "error");
			}
		});
	} catch {
		showToast("Invalid URL", "error");
	}
}

function showToast(message: string, type: "success" | "error"): void {
	const toast = document.getElementById("toast");
	if (!toast) return;

	toast.textContent = message;
	toast.className = `toast ${type} visible`;

	setTimeout(() => {
		toast.classList.remove("visible");
	}, 3000);
}

function setVersion(): void {
	const versionEl = document.getElementById("version");
	if (versionEl) {
		versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
	}
}
