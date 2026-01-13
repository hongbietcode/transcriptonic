# Connecting TranscripTonic to Notion via n8n: A step-by-step guide

This guide will walk you through setting up your **TranscripTonic Chrome extension** to automatically process your meeting transcripts and chat messages using n8n, ultimately saving a version to a Notion database.

> This guide was written with an LLM. Testing and review help is needed.


<br />
<br />

## What you'll achieve

By following these steps, after each meeting, TranscripTonic will send the meeting details, transcript, and chat messages to your n8n workflow. This workflow will then process the data and create a new item in a specified Notion database, keeping your meeting notes organized and accessible.

<br />
<br />


## Part 1: Setting up your Notion Database

First, let's prepare your Notion workspace to receive the meeting data.

1.  **Create a New Database in Notion:**
    * Open Notion and navigate to the page where you want to store your meeting summaries.
    * Type `/database` and select "Database - Inline" or "Database - Full page."
    * Name your database (e.g., "Meeting Summaries").

2.  **Define Database Properties:**
    * You'll need specific properties to store the meeting information. Click on the property names to rename them and select their types. We recommend the following:
        * **Name** (Title): This will be the meeting title (e.g., "Transcript - Meeting with Client X").
        * **Date** (Date): To store the meeting start time.
        * **Summary** (Text or Rich text): For the summary.
        * **Transcript** (Text or Rich text): To store the full meeting transcript.
        * **Chat Messages** (Text or Rich text): To store the chat log.
        * **Meeting ID** (Text): A unique identifier if you want to reference meetings programmatically.

<br />
<br />


## Part 2: Setting up your n8n Workflow

Now, let's build the n8n workflow that will receive data from TranscripTonic and send it to Notion.

1.  **Access your n8n Instance:**
    * Log in to your n8n instance (self-hosted or cloud).
    * Go to your "Workflows" dashboard.

2.  **Create a New Workflow:**
    * Click on "**New Workflow**."

3.  **Add a Webhook Trigger Node:**
    * Click the **"+"** button to add a new node.
    * Search for "**Webhook**" and select the "Webhook" trigger node.
    * **Configure the Webhook Node:**
        * **HTTP Method:** Ensure this is set to `POST`.
        * **Response Mode:** Set to `Last Node`.
        * **Important:** Note the **Test URL** and **Production URL** displayed here. You'll use the **Test URL** for initial testing with TranscripTonic.

4.  **Add a Notion Node:**
    * Click the **"+"** button after the Webhook node.
    * Search for "**Notion**" and select the "Notion" node.
    * **Configure the Notion Node:**
        * **Authentication:** Click "New Credential" and connect your Notion workspace. You'll need to select the pages/databases n8n can access. Make sure your "Meeting Summaries" database is selected.
        * **Resource:** Choose `Page`.
        * **Operation:** Select `Create`.
        * **Database ID:** Click the dropdown and select your "Meeting Summaries" database. If it doesn't appear, you might need to share the integration with the database in Notion or refresh credentials.
        * **Properties:** Map the data from the previous nodes to your Notion database properties using expressions:
            * **Name:** `{{ $json.meetingTitle }}` (or `Transcript - {{ $json.meetingTitle }}`)
            * **Date:** `{{ $json.meetingStartTimestamp }}`
            * **Summary:** `{{ $json.summary }}` (or leave blank if no summarization)
            * **Transcript:** `{{ $json.transcript }}`
            * **Chat Messages:** `{{ $json.chatMessages }}`
            * **Meeting ID:** `{{ $json.meetingStartTimestamp + $json.meetingTitle }}` (You can create a simple unique ID)

<br />
<br />


## Part 3: Configuring your TranscripTonic Chrome extension (for testing)

Now, let's tell the TranscripTonic Chrome extension where to send the meeting data for testing purposes.

1.  **Open TranscripTonic webhooks page:**
    * Click on the TranscripTonic icon in your Chrome browser's toolbar.
    * Click on the "Set up webhooks" link to open the webhooks page.

2.  **Paste the Webhook Test URL:**
    * **Paste the Webhook Test URL** you obtained from the n8n Webhook node (in Part 2, Step 3) into the webhook URL field.
    * Click "Save." Chrome will ask you permission to read and change data on your n8n URL. Click "Allow." This permission is necessary to send data to your n8n workflow in the background after each meeting.

3.  **Configure webhook options:**
    * **Check the box** next to "Automatically post transcript after each meeting, to webhook URL." This ensures your data is sent automatically.
    * Make sure the "**Simple webhook body**" radio button is selected. Your n8n workflow is designed to work with this pre-formatted data.

<br />
<br />


## Part 4: Test your integration! 🚀

The best way to confirm everything is working is to try it out.

1.  **Prepare n8n to listen:**
    * Go back to your n8n workflow.
    * In the Webhook node, click "**Listen for test event**." n8n will now be waiting for data.

2.  **Trigger TranscripTonic:**
    * **Start a short test meeting** (even if it's just with yourself or a quick call).
    * Speak something funny or garbage :P
    * **End the meeting.** TranscripTonic will send the data to the Test URL.

3.  **Observe the workflow:**
    * Switch back to your n8n workflow. You should see the data flowing through the nodes. The Webhook node should receive data, and the Notion node should attempt to create an entry.
    * Check your Notion database to ensure the data appeared correctly.

<br />
<br />


## Part 5: Activate your n8n Workflow (for live use)

Once you've confirmed everything is working with the Test URL, it's time to activate your workflow for regular use.

1.  **Activate the Workflow in n8n:**
    * Go back to your n8n workflow.
    * Click the toggle in the top right corner of your n8n workflow editor to set it to **"Active."** This makes the **Production URL** live.

2.  **Update TranscripTonic with Production URL:**
    * Go back to the TranscripTonic webhooks page in your Chrome extension.
    * **Replace the Test URL** in the webhook URL field with the **Production URL** from your n8n Webhook node.
    * Click "Save."

<br />
<br />


## Troubleshooting tips

* **No entry created in Notion?**
    * **Check the webhook URL:** Double-check that you copied the *entire* **Production URL** from your n8n Webhook node and pasted it correctly into your TranscripTonic extension.
    * **n8n Workflow Status:** Ensure your n8n workflow is **"Active"**.
    * **n8n Executions:** In n8n, go to the "Executions" tab for your workflow (looks like a clock icon). This will show you if the webhook received data and where the workflow might have failed.
    * **Notion Permissions:** In Notion, go to Settings & Members > Integrations. Make sure your n8n integration has access to your "Meeting Summaries" database.
    * **Extension settings:** Make sure "Automatically post transcript..." is checked and "Simple webhook body" is selected in your TranscripTonic extension.

* **Data is missing or malformed in Notion?**
    * **n8n Node Configuration:** Re-examine the mapping in your Notion node in n8n. Ensure the expressions (`{{ $json.transcript }}`, etc.) correctly point to the data from the webhook.
    * **Notion Property Types:** Double-check that the property types in your Notion database (e.g., "Text," "Date") match the type of data you're sending from n8n.

If you follow these steps carefully, you'll have a seamless integration between TranscripTonic and Notion via n8n.