# Connecting TranscripTonic to Google Docs: A step-by-step guide

This guide will walk you through setting up your **TranscripTonic Chrome extension** to automatically save your meeting transcripts and chat messages as Google Docs, in your Google Drive.

### What you'll achieve

By following these steps, after each meeting, TranscripTonic will send the meeting details, transcript, and chat messages to a Google Docs script you'll set up. This script will then automatically create a new Google Doc in a folder called "TranscripTonic" in your Google Drive, keeping everything tidy and accessible.


<br />
<br />

## Part 1: Setting up your Google Apps Script

This script acts as the bridge between the TranscripTonic extension and Google Docs.

1.  **Open Google Apps Script:**

    * Go to `script.google.com` in your web browser.
    * If prompted, sign in with your Google account.
    * Click on "**New project**" (or "New script" if you see that option).

2.  **Paste the script code:**

    * You'll see an empty code editor with a file named `Code.gs`.
    * Delete any existing code in `Code.gs` and paste the following entire script into the editor:

<br />

````
/**
 * This script serves as a web app endpoint to receive webhook data,
 * create a Google Doc from it, and save it to a specific Google Drive folder.
 */

/**
 * Handles HTTP POST requests sent to the web app.
 * This function is automatically triggered when a POST request is received.
 *
 * @param {Object} e The event object containing the POST request parameters.
 * For JSON payloads, e.postData.contents will contain the raw JSON string.
 * For form data, e.parameter will contain key-value pairs.
 * @returns {GoogleAppsScript.Content.TextOutput} A JSON response indicating success or failure.
 */
function doPost(e) {
  // Set the response content type to JSON.
  // This is important so the webhook sender knows the response format.
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    // 1. Parse the incoming JSON payload from the webhook.
    // The webhook body is expected to be in JSON format.
    if (!e.postData || e.postData.type !== "application/json") {
      throw new Error("Invalid content type. Expected application/json.");
    }
    const requestBody = JSON.parse(e.postData.contents);

    // 2. Extract data from the parsed webhook body using destructuring with default values.
    const {
      meetingTitle = "Untitled Meeting",
      meetingSoftware = "",
      meetingStartTimestamp = "N/A",
      meetingEndTimestamp = "N/A",
      transcript = "No transcript provided.",
      chatMessages = "No chat messages provided."
    } = requestBody;

    // 3. Create a new Google Doc.
    // The document name will be the meeting title followed by the start date.
    const docName = `${meetingSoftware}${meetingSoftware ? ` t` : `T`}ranscript-${meetingTitle} at ${meetingStartTimestamp}`;
    const doc = DocumentApp.create(docName);
    const body = doc.getBody();

    // Clear any default content (like "Untitled document").
    body.clear();

    // Apply native Google Doc formatting:

    // Meeting Title (Heading 1)
    const titleParagraph = body.appendParagraph(meetingTitle);
    titleParagraph.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    titleParagraph.setAlignment(DocumentApp.HorizontalAlignment.CENTER); // Center the title

    // Meeting Details
    body.appendParagraph("").setSpacingAfter(0); // Add a small space
    const startParagraph = body.appendParagraph("Start Time: ");
    startParagraph.appendText(meetingStartTimestamp).setBold(true);
    const endParagraph = body.appendParagraph("End Time: ");
    endParagraph.appendText(meetingEndTimestamp).setBold(true);
    body.appendParagraph("").setSpacingAfter(12); // Add a bit more space after details

    // Horizontal Rule
    body.appendHorizontalRule();
    body.appendParagraph("").setSpacingAfter(12); // Space after rule

    // Transcript Section (Heading 2)
    const transcriptHeading = body.appendParagraph("Transcript");
    transcriptHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(transcript);
    body.appendParagraph("").setSpacingAfter(12); // Space after transcript

    // Horizontal Rule
    body.appendHorizontalRule();
    body.appendParagraph("").setSpacingAfter(12); // Space after rule

    // Chat Messages Section (Heading 2)
    const chatHeading = body.appendParagraph("Chat Messages");
    chatHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(chatMessages);
    body.appendParagraph("").setSpacingAfter(12); // Space after chat messages

    // Horizontal Rule
    body.appendHorizontalRule();
    body.appendParagraph("").setSpacingAfter(12); // Space after rule

    body.appendParagraph("Transcript saved using TranscripTonic Chrome extension (https://chromewebstore.google.com/detail/ciepnfnceimjehngolkijpnbappkkiag)")

    // Save and close the document to ensure changes are committed.
    doc.saveAndClose();

    // 4. Find or create the "TranscripTonic" folder.
    const folderName = "TranscripTonic";
    const folders = DriveApp.getFoldersByName(folderName);
    let targetFolder;

    if (folders.hasNext()) {
      // Folder already exists, use the first one found.
      targetFolder = folders.next();
    } else {
      // Folder does not exist, create it in the root of My Drive.
      targetFolder = DriveApp.createFolder(folderName);
      Logger.log(`Created new folder: ${folderName}`);
    }

    // 5. Move the newly created Google Doc to the "TranscripTonic" folder.
    const file = DriveApp.getFileById(doc.getId());

    // Move the file from root to target folder
    file.moveTo(targetFolder);

    Logger.log(`Successfully created and moved document: ${docName} (ID: ${doc.getId()}) to folder: ${targetFolder.getName()}`);

    // 6. Return a success response.
    output.setContent(JSON.stringify({ status: "success", message: "Document created and saved successfully!", docId: doc.getId(), docUrl: doc.getUrl() }));

  } catch (error) {
    // Log any errors that occur during execution.
    Logger.log(`Error: ${error.message}`);
    // Return an error response.
    output.setContent(JSON.stringify({ status: "error", message: error.message }));
  }
  return output;
}
````

3.  **Save your project:**

    * Click the **Save project** icon (looks like a floppy disk) in the toolbar.
    * When prompted, give your project a name like `TranscripTonic Webhook` and click **Rename**.

4.  **Deploy as a web app:**

    * Click the **Deploy** button in the top right corner.
    * Select "**New deployment**" from the dropdown.
    * In the "Select type" section, choose **Web app**.
    * **Configure the deployment:**
        * **Description:** (Optional) You can add a description like "Receives TranscripTonic webhooks and creates Google Docs."
        * **Execute as:** Make sure this is set to `Me (your_email@gmail.com)`. This means the script will run using your Google account's permissions.
        * **Who has access:** **Critical!** Set this to `Anyone`. This allows your Chrome extension to send data to the script.
    * Click the **Deploy** button.

5.  **Authorize the script (first time only):**

    * A window will pop up asking for authorization. Click "**Authorize access**".
    * Select the Google account you are using.
    * You might see a warning that "Google hasn't verified this app." This is normal because you created the script yourself. There is no need to get it verified since it is for your own use. Click "**Advanced**" and then "Go to TranscripTonic Webhook (unsafe)" (or whatever you named your project).
    * Review the permissions (it needs access to your Google Drive to create and move files) and click **Allow**.

6.  **Copy your web app URL:**

    * After successful deployment and authorization, you'll see a dialog with your **Web app URL**.
    * **Copy this entire URL.** It will look something like `https://script.google.com/macros/s/AKfyc.../exec`. This is the unique address for your script.
    * Click "Done".

<br />
<br />

## Part 2: Configuring your TranscripTonic Chrome extension

Now, let's tell the TranscripTonic Chrome extension where to send the meeting data.

1.  **Open TranscripTonic webhooks page:**

    * Click on the TranscripTonic icon in your Chrome browser's toolbar.
    * Click on the "Set up webhooks" link to open the webhooks page.

2.  **Paste the webhook URL:**

    * **Paste the Web App URL** you copied from Google Apps Script into the webhook URL field.
    * Click "Save." Chrome will ask you permission to read and change data on script.google.com. Click "Allow." This permission is necessary to send data to the script in the background after each meeting.

3.  **Configure webhook options:**

    * **Check the box** next to "Automatically post transcript after each meeting, to webhook URL." This ensures your data is sent automatically.
    * Make sure the "**Simple webhook body**" radio button is selected. Your Apps Script is designed to work with this pre-formatted data.

<br />
<br />

## Part 3: Test your integration!

The best way to confirm everything is working is to try it out.

1.  **Start a short test meeting** (even if it's just with yourself or a quick call).
2.  Speak something funny or garbage :P
3.  **End the meeting.**
4.  **Check your Google Drive:**
    * Go to `drive.google.com`.
    * You should now see a new folder called "**TranscripTonic**".
    * Inside that folder, you should find a new Google Doc with the title of your test meeting and its date, containing the transcript and chat messages.

<br />
<br />

## Troubleshooting tips

* **No document created?**

    * **Check the web app URL:** Double-check that you copied the *entire* URL correctly and pasted it into your extension.
    * **Deployment access:** Go back to your Apps Script project, click Deploy > Manage deployments, and ensure "Who has access" is set to `Anyone`.
    * **Script errors:** In your Apps Script project, go to the "Executions" tab (left sidebar, looks like a clock icon). If there were errors, they will be listed here, which can help you identify the problem.
    * **Extension settings:** Make sure "Automatically post transcript..." is checked and "Simple webhook body" is selected in your TranscripTonic extension.

* **Document created, but formatting is off?**

    * Ensure you replaced the *entire* script code in `Code.gs` with the latest version provided in this guide. Then, redeploy the script by creating a "New version" (Deploy > Manage deployments > Edit pencil icon > Version: New version > Deploy).

If you follow these steps carefully, you'll have a seamless integration between TranscripTonic and Google Docs.


<br />
<br />

This guide was written with an LLM, but was edited and tested thoroughly for correctness.