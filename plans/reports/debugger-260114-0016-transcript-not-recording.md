# Investigation Report: Transcription Not Recording in Google Meet

**Date:** 2026-01-14
**Issue:** "không ghi transcript khi mở google meet" (Transcription not recording in Google Meet)
**Investigator:** Debugger Agent
**Codebase:** TranscripTonic v0.1.0

---

## Executive Summary

**Root Cause Identified:** Extension disabled due to unreachable status check URL.

**Impact:** Extension fails to initialize transcription functionality when status URL `https://hongbietcode.github.io/transcripto-status/status-prod-meet.json` returns 404.

**Priority:** CRITICAL - Extension completely non-functional.

**Recommended Fix:** Replace status URL with valid endpoint or implement fallback mechanism.

---

## Technical Analysis

### 1. Status Check Failure (PRIMARY ROOT CAUSE)

**Location:** `src/content.ts:612`

```typescript
fetch("https://hongbietcode.github.io/transcripto-status/status-prod-meet.json", { cache: "no-store" })
```

**Evidence:**
- URL returns HTTP 404 (confirmed via curl test)
- Changed in commit `8ff7d47` (Jan 13, 2026)
- Previous repository structure not migrated to new location

**Impact Chain:**
1. Fetch fails → `checkExtensionStatus()` promise rejects
2. Line 71: `.finally()` executes but `extensionStatusJSON` remains unset or defaults
3. Line 75: `if (extensionStatusJSON.status === 200)` fails
4. Line 99: Shows downtime notification instead of initializing
5. `meetingRoutines(2)` never executes
6. No transcript observers registered

**Error Flow:**
```typescript
checkExtensionStatus().finally(() => {
    console.log("Extension status " + extensionStatusJSON.status);

    if (extensionStatusJSON.status === 200) {
        // meetingRoutines(2); <- NEVER REACHED
    } else {
        showNotification(extensionStatusJSON); // <- SHOWS ERROR
    }
});
```

**Current Behavior:**
- Line 609: Default status set to 200
- Line 630-634: Catch block logs error but doesn't show user notification about fetch failure
- Extension silently fails with generic downtime message

---

### 2. DOM Selector Verification (SECONDARY CONCERN)

**Current Selectors (UI Type 2):**
```typescript
meetingEndIconData.selector = ".google-symbols";
meetingEndIconData.text = "call_end";
captionsIconData.selector = ".google-symbols";
captionsIconData.text = "closed_caption_off";
```

**Transcript Container Selector:**
```typescript
waitForElement(`div[role="region"][tabindex="0"]`)
```

**Status:** Cannot verify without functional status check. Selectors appear consistent with documented DOM structure (lines 657-695).

**Risk:** Google Meet frequently changes DOM. If status check worked, selector failures would trigger:
- Line 177-186: Error notification + error logging (code "001")
- Line 350-356: Mutation callback error handling
- `isTranscriptDomErrorCaptured` flag prevents notification spam

---

### 3. Initialization Logic Dependencies

**Dependency Chain:**
```
checkExtensionStatus()
  → extensionStatusJSON.status === 200
    → meetingRoutines(2)
      → waitForElement(meetingEndIconData)
        → waitForElement(captionsIconData)
          → waitForElement('div[role="region"][tabindex="0"]')
            → transcriptObserver.observe()
```

**Current State:** Chain breaks at step 1.

---

### 4. Error Handling Analysis

**Silent Failures Detected:**

1. **Status Fetch Failure** (Line 630-634):
   - Logs to console: `console.error(err)`
   - Logs to remote: `logError("008", err)`
   - **NO USER NOTIFICATION** about network failure
   - User sees generic downtime message instead

2. **Misleading Notification** (Line 99):
   - Shows `extensionStatusJSON` which may be undefined or default
   - Does not distinguish between:
     - Intentional downtime (status 400 from server)
     - Network failure (fetch error)
     - Invalid response

3. **Potential Race Condition** (Line 608-609):
   - Default set before fetch: `extensionStatusJSON = { status: 200, ... }`
   - If fetch fails, default persists but code treats it as server-returned value
   - Line 75 check may pass incorrectly if promise resolves despite fetch error

---

## Evidence Summary

### Confirmed Issues

1. **404 Response from Status URL:**
   ```
   https://hongbietcode.github.io/transcripto-status/status-prod-meet.json
   → GitHub Pages "File not found"
   ```

2. **Recent URL Change (Commit 8ff7d47):**
   - Date: Jan 13, 2026 (1 day before report)
   - Message: "fix: update URLs to point to new repository location"
   - Changed from old repository to `hongbietcode/transcripto-status`
   - Status JSON files not deployed to new location

3. **Extension Version:** v0.1.0 (manifest.json)

4. **User Symptoms Match:**
   - No transcription recording
   - Likely seeing notification: "TranscripTonic is not running"

---

## Root Cause Confirmation

**Primary:** Status check URL unreachable → extension self-disables.

**Contributing Factors:**
- Incomplete migration to new repository
- No fallback mechanism for status check failures
- Misleading error messages (doesn't inform user about network failure)

---

## Recommended Solutions

### Immediate Fixes (Priority Order)

1. **Deploy Status JSON:**
   - Create GitHub Pages repo `hongbietcode/transcripto-status`
   - Deploy `status-prod-meet.json` with:
     ```json
     {
       "minVersion": "0.1.0",
       "status": 200,
       "message": "<strong>TranscripTonic is running</strong> <br /> Do not turn off captions"
     }
     ```

2. **Add Fallback Mechanism:**
   - Modify `checkExtensionStatus()` to default to enabled on fetch failure
   - Log error but don't disable extension

3. **Improve Error Messages:**
   - Show user-facing notification when status fetch fails
   - Distinguish between:
     - Network errors → "Unable to check status, proceeding anyway"
     - Server downtime → "Service temporarily unavailable"

### Long-term Improvements

1. **Remove External Dependency:**
   - Embed status check in extension or use extension update mechanism
   - Only disable for critical breaking changes

2. **Add Graceful Degradation:**
   - Allow manual override to bypass status check
   - Store last successful status with timestamp

3. **Enhanced Error Logging:**
   - Add user-visible debug mode
   - Log DOM selector failures with screenshots to help diagnose Google Meet changes

4. **Version Check Optimization:**
   - Cache status response with TTL
   - Only check once per session

---

## Testing Recommendations

### Verify Fix:
1. Deploy status JSON to correct URL
2. Clear browser cache
3. Reload extension
4. Join Google Meet
5. Verify console shows: "Extension status 200"
6. Verify transcript observer initializes

### Regression Tests:
1. Test with unreachable status URL (network failure)
2. Test with status 400 response (intentional downtime)
3. Test with invalid JSON response
4. Test version mismatch (minVersion > current version)

---

## Unresolved Questions

1. **Why was status URL changed?**
   - Is `hongbietcode/transcripto-status` repo public/private?
   - Was GitHub Pages enabled on new repo?

2. **Are other users affected?**
   - Check if status JSON exists for Zoom/Teams variants
   - Same URL pattern used in `content-zoom.ts` and `content-teams.ts`

3. **What's the intended status check behavior?**
   - Should extension fail-closed (disable on error) or fail-open (enable on error)?
   - Current implementation fails-closed, which seems overly cautious

4. **Is minVersion check working correctly?**
   - Line 618: `meetsMinVersion()` function logic unclear without testing
   - Could this cause issues even if status URL works?

---

## Files Requiring Changes

1. `/src/content.ts` (lines 606-637)
2. `/src/content-zoom.ts` (similar issue)
3. `/src/content-teams.ts` (similar issue)
4. Deploy: `status-prod-meet.json` to GitHub Pages

---

**Next Steps:** Deploy status JSON or implement fallback before fixing DOM selectors.
