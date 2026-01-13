import type { ResultSync, ExtensionMessage, ExtensionResponse } from "./types/index";

window.onload = function () {
	const autoModeRadio = document.querySelector("#auto-mode") as HTMLInputElement | null;
	const manualModeRadio = document.querySelector("#manual-mode") as HTMLInputElement | null;
	const versionElement = document.querySelector("#version");
	const enableBeta = document.querySelector("#enable-beta");
	// const notice = document.querySelector("#notice")

	if (versionElement) {
		versionElement.innerHTML = `v${chrome.runtime.getManifest().version}`;
	}

	chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
		const resultSync = resultSyncUntyped as ResultSync;

		if (autoModeRadio && manualModeRadio) {
			if (resultSync.operationMode === "manual") {
				manualModeRadio.checked = true;
			} else {
				autoModeRadio.checked = true;
			}

			autoModeRadio.addEventListener("change", function () {
				chrome.storage.sync.set({ operationMode: "auto" }, function () {});
			});
			manualModeRadio.addEventListener("change", function () {
				chrome.storage.sync.set({ operationMode: "manual" }, function () {});
			});
		}
	});

	enableBeta?.addEventListener("click", () => {
		chrome.permissions
			.request({
				origins: ["https://*.zoom.us/*", "https://teams.live.com/*", "https://teams.microsoft.com/*"],
				permissions: ["notifications"],
			})
			.then((granted) => {
				if (granted) {
					const message: ExtensionMessage = {
						type: "register_content_scripts",
					};
					chrome.runtime.sendMessage(message, (responseUntyped) => {
						const response = responseUntyped as ExtensionResponse;
						// Prevent alert as well as notification from background script
						if (response.success) {
							if (response.message !== "Zoom and Teams content scripts registered") {
								alert("Already enabled! Go ahead, enjoy your day!");
							}
						} else {
							console.error(response.message);
							alert("Failed to enable. Please try again.");
						}
					});
				} else {
					alert("Permission denied");
				}
			})
			.catch((error) => {
				console.error(error);
				alert("Could not enable Zoom and Teams transcripts");
			});
	});

	// notice?.addEventListener("click", () => {
	//   alert("The transcript may not always be accurate and is only intended to aid in improving productivity. It is the responsibility of the user to ensure they comply with any applicable laws/rules.")
	// })
};
