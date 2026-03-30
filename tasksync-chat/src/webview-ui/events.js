// ==================== Event Listeners ====================

function bindEventListeners() {
	if (chatInput) {
		chatInput.addEventListener("input", handleTextareaInput);
		chatInput.addEventListener("keydown", handleTextareaKeydown);
		chatInput.addEventListener("paste", handlePaste);
		// Sync scroll between textarea and highlighter
		chatInput.addEventListener("scroll", function () {
			if (inputHighlighter) {
				inputHighlighter.scrollTop = chatInput.scrollTop;
			}
		});
	}
	if (sendBtn) sendBtn.addEventListener("click", handleSend);
	if (attachBtn) attachBtn.addEventListener("click", handleAttach);
	if (modeBtn) modeBtn.addEventListener("click", toggleModeDropdown);

	document
		.querySelectorAll(".mode-option[data-mode]")
		.forEach(function (option) {
			option.addEventListener("click", function () {
				setMode(option.getAttribute("data-mode"), true);
				closeModeDropdown();
			});
		});

	document.addEventListener("click", function (e) {
		let markdownLink =
			e.target && e.target.closest
				? e.target.closest("a.markdown-link[data-link-target]")
				: null;
		if (markdownLink) {
			e.preventDefault();
			let markdownLinksApi = window.TaskSyncMarkdownLinks;
			let encodedTarget = markdownLink.getAttribute("data-link-target");
			if (
				encodedTarget &&
				markdownLinksApi &&
				typeof markdownLinksApi.toWebviewMessage === "function"
			) {
				const linkMessage = markdownLinksApi.toWebviewMessage(encodedTarget);
				if (linkMessage) {
					vscode.postMessage(linkMessage);
				}
			}
			return;
		}

		if (
			dropdownOpen &&
			!e.target.closest(".mode-selector") &&
			!e.target.closest(".mode-dropdown")
		)
			closeModeDropdown();
		if (
			autocompleteVisible &&
			!e.target.closest(".autocomplete-dropdown") &&
			!e.target.closest("#chat-input")
		)
			hideAutocomplete();
		if (
			slashDropdownVisible &&
			!e.target.closest(".slash-dropdown") &&
			!e.target.closest("#chat-input")
		)
			hideSlashDropdown();
	});

	// Remember right-click target so context-menu Copy can resolve the exact clicked message.
	document.addEventListener("contextmenu", handleContextMenu);
	// Intercept Copy when nothing is selected and copy clicked message text as-is.
	document.addEventListener("copy", handleCopy);

	if (queueHeader)
		queueHeader.addEventListener("click", handleQueueHeaderClick);
	if (historyModalClose)
		historyModalClose.addEventListener("click", closeHistoryModal);
	if (historyModalClearAll)
		historyModalClearAll.addEventListener("click", clearAllPersistedHistory);
	if (historyModalOverlay) {
		historyModalOverlay.addEventListener("click", function (e) {
			if (e.target === historyModalOverlay) closeHistoryModal();
		});
	}

	// Hub & Thread Shell events
	if (hubNewSessionBtn)
		hubNewSessionBtn.addEventListener("click", openNewSessionModal);
	if (hubHistoryBtn) hubHistoryBtn.addEventListener("click", openHistoryModal);
	if (hubSettingsBtn)
		hubSettingsBtn.addEventListener("click", openSettingsModal);
	if (threadBackBtn) {
		threadBackBtn.addEventListener("click", function () {
			vscode.postMessage({ type: "switchSession", sessionId: null });
		});
	}
	if (threadHistoryBtn)
		threadHistoryBtn.addEventListener("click", openHistoryModal);
	if (threadSettingsBtn)
		threadSettingsBtn.addEventListener("click", openSessionSettingsModal);

	// Session settings modal events
	bindSessionSettingsEvents();

	// Edit mode button events
	if (editCancelBtn) editCancelBtn.addEventListener("click", cancelEditMode);
	if (editConfirmBtn) editConfirmBtn.addEventListener("click", confirmEditMode);

	// Approval modal button events
	if (approvalContinueBtn)
		approvalContinueBtn.addEventListener("click", handleApprovalContinue);
	if (approvalNoBtn) approvalNoBtn.addEventListener("click", handleApprovalNo);

	// Settings modal events
	if (settingsModalClose)
		settingsModalClose.addEventListener("click", closeSettingsModal);
	if (settingsModalOverlay) {
		settingsModalOverlay.addEventListener("click", function (e) {
			if (e.target === settingsModalOverlay) closeSettingsModal();
		});
	}
	if (soundToggle) {
		soundToggle.addEventListener("click", toggleSoundSetting);
		soundToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleSoundSetting();
			}
		});
	}
	if (interactiveApprovalToggle) {
		interactiveApprovalToggle.addEventListener(
			"click",
			toggleInteractiveApprovalSetting,
		);
		interactiveApprovalToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleInteractiveApprovalSetting();
			}
		});
	}
	if (autoAppendToggle) {
		autoAppendToggle.addEventListener("click", toggleAutoAppendSetting);
		autoAppendToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAutoAppendSetting();
			}
		});
	}
	if (autoAppendTextInput) {
		autoAppendTextInput.addEventListener("change", handleAutoAppendTextChange);
		autoAppendTextInput.addEventListener("blur", handleAutoAppendTextChange);
	}
	if (alwaysAppendReminderToggle) {
		alwaysAppendReminderToggle.addEventListener(
			"click",
			toggleAlwaysAppendReminderSetting,
		);
		alwaysAppendReminderToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAlwaysAppendReminderSetting();
			}
		});
	}
	if (sendShortcutToggle) {
		sendShortcutToggle.addEventListener(
			"click",
			toggleSendWithCtrlEnterSetting,
		);
		sendShortcutToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleSendWithCtrlEnterSetting();
			}
		});
	}
	if (autopilotToggle) {
		autopilotToggle.addEventListener("click", toggleAutopilotSetting);
		autopilotToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAutopilotSetting();
			}
		});
	}
	// Autopilot prompts list event listeners
	if (autopilotAddBtn) {
		autopilotAddBtn.addEventListener("click", showAddAutopilotPromptForm);
	}
	if (saveAutopilotPromptBtn) {
		saveAutopilotPromptBtn.addEventListener("click", saveAutopilotPrompt);
	}
	if (cancelAutopilotPromptBtn) {
		cancelAutopilotPromptBtn.addEventListener(
			"click",
			hideAddAutopilotPromptForm,
		);
	}
	// List-level events (click, drag) are bound via initWorkspacePromptListUI()
	if (responseTimeoutSelect) {
		responseTimeoutSelect.addEventListener(
			"change",
			handleResponseTimeoutChange,
		);
	}
	if (sessionWarningHoursSelect) {
		sessionWarningHoursSelect.addEventListener(
			"change",
			handleSessionWarningHoursChange,
		);
	}
	if (maxAutoResponsesInput) {
		maxAutoResponsesInput.addEventListener(
			"change",
			handleMaxAutoResponsesChange,
		);
		maxAutoResponsesInput.addEventListener(
			"blur",
			handleMaxAutoResponsesChange,
		);
	}
	if (remoteMaxDevicesInput) {
		remoteMaxDevicesInput.addEventListener(
			"change",
			handleRemoteMaxDevicesChange,
		);
		remoteMaxDevicesInput.addEventListener(
			"blur",
			handleRemoteMaxDevicesChange,
		);
	}
	if (humanDelayToggle) {
		humanDelayToggle.addEventListener("click", toggleHumanDelaySetting);
		humanDelayToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleHumanDelaySetting();
			}
		});
	}
	if (humanDelayMinInput) {
		humanDelayMinInput.addEventListener("change", handleHumanDelayMinChange);
		humanDelayMinInput.addEventListener("blur", handleHumanDelayMinChange);
	}
	if (humanDelayMaxInput) {
		humanDelayMaxInput.addEventListener("change", handleHumanDelayMaxChange);
		humanDelayMaxInput.addEventListener("blur", handleHumanDelayMaxChange);
	}
	if (addPromptBtn) addPromptBtn.addEventListener("click", showAddPromptForm);
	// Add prompt form events (deferred - bind after modal created)
	let cancelPromptBtn = document.getElementById("cancel-prompt-btn");
	let savePromptBtn = document.getElementById("save-prompt-btn");
	if (cancelPromptBtn)
		cancelPromptBtn.addEventListener("click", hideAddPromptForm);
	if (savePromptBtn) savePromptBtn.addEventListener("click", saveNewPrompt);

	window.addEventListener("message", handleExtensionMessage);
}

function bindSessionSettingsEvents() {
	var ssCloseBtn = document.getElementById("ss-close-btn");
	var ssResetBtn = document.getElementById("ss-reset-btn");

	if (sessionSettingsOverlay) {
		sessionSettingsOverlay.addEventListener("click", function (e) {
			if (e.target === sessionSettingsOverlay) closeSessionSettingsModal();
		});
	}
	if (ssCloseBtn)
		ssCloseBtn.addEventListener("click", closeSessionSettingsModal);
	if (ssResetBtn) ssResetBtn.addEventListener("click", resetSessionSettings);
	if (ssAutopilotToggle) {
		ssAutopilotToggle.addEventListener("click", ssToggleAutopilot);
		ssAutopilotToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				ssToggleAutopilot();
			}
		});
	}
	if (ssAutoAppendToggle) {
		ssAutoAppendToggle.addEventListener("click", ssToggleAutoAppend);
		ssAutoAppendToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				ssToggleAutoAppend();
			}
		});
	}
	if (ssAlwaysAppendReminderToggle) {
		ssAlwaysAppendReminderToggle.addEventListener(
			"click",
			ssToggleAlwaysAppendReminder,
		);
		ssAlwaysAppendReminderToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				ssToggleAlwaysAppendReminder();
			}
		});
	}
	if (ssAddAutopilotPromptBtn)
		ssAddAutopilotPromptBtn.addEventListener("click", ssShowAddPromptForm);
	if (ssSaveAutopilotPromptBtn)
		ssSaveAutopilotPromptBtn.addEventListener("click", ssSavePrompt);
	if (ssCancelAutopilotPromptBtn)
		ssCancelAutopilotPromptBtn.addEventListener("click", ssHideAddPromptForm);
	// List-level events (click, drag) are bound via initSessionPromptListUI()
}
