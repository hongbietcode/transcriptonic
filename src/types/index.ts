// Type definitions for TranscripTonic Chrome Extension

export interface TranscriptBlock {
	/** name of the person who spoke */
	personName: string;
	/** ISO timestamp of when the words were spoken */
	timestamp: string;
	/** actual transcript text */
	transcriptText: string;
}

export interface ChatMessage {
	/** name of the person who sent the message */
	personName: string;
	/** ISO timestamp of when the message was sent */
	timestamp: string;
	/** actual message text */
	chatMessageText: string;
}

export interface WebhookBody {
	webhookBodyType: "simple" | "advanced";
	meetingSoftware: MeetingSoftware;
	meetingTitle: string;
	meetingStartTimestamp: string;
	meetingEndTimestamp: string;
	/** transcript as a formatted string or array containing transcript blocks from the meeting */
	transcript: TranscriptBlock[] | string;
	/** chat messages as a formatted string or array containing chat messages from the meeting */
	chatMessages: ChatMessage[] | string;
}

// LOCAL CHROME STORAGE VARIABLES

export interface ResultLocal {
	extensionStatusJSON?: ExtensionStatusJSON;
	meetingTabId?: MeetingTabId;
	meetingSoftware?: MeetingSoftware;
	meetingTitle?: MeetingTitle;
	meetingStartTimestamp?: MeetingStartTimestamp;
	transcript?: Transcript;
	chatMessages?: ChatMessages;
	isDeferredUpdatedAvailable?: IsDeferredUpdatedAvailable;
	meetings?: Meeting[];
}

export interface ExtensionStatusJSON {
	/** status of the extension */
	status: number;
	/** message of the status */
	message: string;
}

export interface Meeting {
	meetingSoftware?: MeetingSoftware;
	/** title of the meeting */
	meetingTitle?: string;
	/** title of the meeting (this is older key for meetingTitle key, in v3.1.0) */
	title?: string;
	/** ISO timestamp of when the meeting started */
	meetingStartTimestamp: string;
	/** ISO timestamp of when the meeting ended */
	meetingEndTimestamp: string;
	/** array containing transcript blocks from the meeting */
	transcript: TranscriptBlock[] | [];
	/** array containing chat messages from the meeting */
	chatMessages: ChatMessage[] | [];
	/** status of the webhook post request */
	webhookPostStatus: "new" | "failed" | "successful";
}

/** Google Meet or Zoom or Teams or undefined */
export type MeetingSoftware = "Google Meet" | "Zoom" | "Teams" | "" | undefined;

/** tab id of the meeting tab, captured when meeting starts. A valid value or "processing" indicates that a meeting is in progress. Set to null once meeting ends and associated processing is complete. */
export type MeetingTabId = number | "processing" | null;

/** ISO timestamp of when the most recent meeting started, dumped by content script */
export type MeetingStartTimestamp = string;

/** title of the most recent meeting, dumped by content script */
export type MeetingTitle = string;

/** Transcript of the most recent meeting, dumped by content script */
export type Transcript = TranscriptBlock[];

/** Chat messages captured during the most recent meeting, dumped by content script */
export type ChatMessages = ChatMessage[];

/** whether the extension has a deferred updated waiting to be applied */
export type IsDeferredUpdatedAvailable = boolean;

// SYNC CHROME STORAGE VARIABLES

export interface ResultSync {
	autoPostWebhookAfterMeeting?: AutoPostWebhookAfterMeeting;
	operationMode?: OperationMode;
	webhookBodyType?: WebhookBodyType;
	webhookUrl?: WebhookUrl;
}

/** Whether to automatically post the webhook after each meeting */
export type AutoPostWebhookAfterMeeting = boolean;

/** mode of the extension which decides whether to automatically capture transcripts or let the user decide per meeting basis */
export type OperationMode = "auto" | "manual";

/** type of webhook body to use */
export type WebhookBodyType = "simple" | "advanced";

/** URL of the webhook */
export type WebhookUrl = string;

export interface ExtensionMessage {
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

export interface StreamingMessage {
	type: "transcript_entry" | "meeting_info" | "meeting_started" | "meeting_ended";
	data?: TranscriptBlock | MeetingInfo;
}

export interface MeetingInfo {
	meetingSoftware: MeetingSoftware;
	meetingTitle: string;
	meetingStartTimestamp: string;
}

export interface PortMessage {
	type: "subscribe" | "unsubscribe";
	source: "content" | "meetings_page";
}

export interface ExtensionResponse {
	/** whether the message was processed successfully as per the request */
	success: boolean;
	/** message explaining success or failure */
	message?: string | ErrorObject;
}

export interface ErrorObject {
	/** error code */
	errorCode: string;
	/** message explaining the error */
	errorMessage: string;
}

/*
 * CONTENT SCRIPT ERRORS
 * | Error Code | Error Message |
 * | :--- | :--- |
 * | **001** | "Transcript element not found in DOM" |
 * | **002** | "Chat messages element not found in DOM" |
 * | **003** | "Chat button element not found in DOM" |
 * | **004** | "Call end button element not found in DOM" |
 * | **005** | "Transcript mutation failed to process" |
 * | **006** | "Chat messages mutation failed to process" |
 * | **007** | "Meeting title element not found in DOM" (currently not in use) |
 * | **008** | "Failed to fetch extension status" |
 * | **016** | "Recovery timed out" |
 *
 * BACKGROUND SCRIPT ERRORS
 * | Error Code | Error Message |
 * | :--- | :--- |
 * | **009** | "Failed to read blob" |
 * | **010** | "Meeting at specified index not found" |
 * | **011** | "Webhook request failed with HTTP status code [number] [statusText]" |
 * | **012** | "No webhook URL configured" |
 * | **013** | "No meetings found. May be attend one?" |
 * | **014** | "Empty transcript and empty chatMessages" |
 * | **015** | "Invalid index" |
 */
