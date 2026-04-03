// ==================== Event Listeners ====================

/**
 * Keep Escape handling centralized so dialogs created in different files close the same way.
 */
function isOverlayVisible(overlay) {
	return !!(
		overlay &&
		overlay.classList &&
		typeof overlay.classList.contains === "function" &&
		!overlay.classList.contains("hidden")
	);
}

/**
 * Move keyboard focus into an opened dialog so keyboard shortcuts work immediately.
 */
function clearPendingDialogFocus(overlay) {
	if (!overlay || overlay.__tasksyncFocusTimer == null) return;
	clearTimeout(overlay.__tasksyncFocusTimer);
	overlay.__tasksyncFocusTimer = null;
}

/**
 * Resolve the best focus target inside an open dialog.
 */
function resolveDialogFocusTarget(overlay, preferredSelector) {
	if (!overlay) return null;

	var target = null;
	if (preferredSelector && typeof overlay.querySelector === "function") {
		target = overlay.querySelector(preferredSelector);
	}
	if (!target && typeof overlay.querySelector === "function") {
		target = overlay.querySelector(
			'textarea:not([disabled]), input:not([disabled]), select:not([disabled]), button:not([disabled]), [role="switch"][tabindex], [tabindex]:not([tabindex="-1"])',
		);
	}
	if (!target && typeof overlay.querySelector === "function") {
		target = overlay.querySelector('[role="dialog"], [role="alertdialog"]');
	}
	if (!target && typeof overlay.focus === "function") {
		target = overlay;
	}

	return target;
}

/**
 * Avoid restoring focus to toolbar-style opener buttons because their visible focus ring looks like a stale selection.
 */
function shouldRestoreDialogFocusTarget(target) {
	if (!target || typeof target.focus !== "function") return false;

	var tagName =
		typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
	if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
		return true;
	}
	if (target.isContentEditable) {
		return true;
	}

	var role =
		typeof target.getAttribute === "function"
			? target.getAttribute("role")
			: null;
	if (role === "button" || role === "switch") {
		return false;
	}

	if (tagName === "BUTTON") {
		return false;
	}

	var classList = target.classList;
	if (
		classList &&
		typeof classList.contains === "function" &&
		(classList.contains("icon-btn") ||
			classList.contains("remote-btn") ||
			classList.contains("settings-modal-header-btn"))
	) {
		return false;
	}

	return true;
}

/**
 * Keep only the currently opened dialog eligible for deferred focus.
 */
function focusDialogSurface(overlay, preferredSelector) {
	if (!overlay) return;
	clearPendingDialogFocus(overlay);

	if (
		typeof document !== "undefined" &&
		document.activeElement &&
		document.activeElement !== document.body &&
		document.activeElement !== overlay &&
		(!overlay.contains || !overlay.contains(document.activeElement))
	) {
		overlay.__tasksyncReturnFocus = document.activeElement;
	}

	overlay.__tasksyncFocusTimer = setTimeout(function () {
		overlay.__tasksyncFocusTimer = null;
		if (!isOverlayVisible(overlay)) return;

		var target = resolveDialogFocusTarget(overlay, preferredSelector);
		if (target && typeof target.focus === "function") {
			target.focus();
		}
	}, 0);
}

/**
 * Return keyboard focus after a dialog closes so the user can continue without an extra click.
 */
function restoreDialogFocus(overlay) {
	if (!overlay) return;
	clearPendingDialogFocus(overlay);

	var target = overlay.__tasksyncReturnFocus;
	overlay.__tasksyncReturnFocus = null;

	if (
		shouldRestoreDialogFocusTarget(target) &&
		target &&
		typeof target.focus === "function" &&
		typeof document !== "undefined" &&
		typeof document.contains === "function" &&
		document.contains(target)
	) {
		target.focus();
		return;
	}

	if (chatInput && typeof chatInput.focus === "function") {
		chatInput.focus();
	}
}

/**
 * Close only the topmost visible dialog so Escape never dismisses multiple layers at once.
 */
function handleGlobalDocumentKeydown(e) {
	if (e.defaultPrevented || e.key !== "Escape") return;

	if (isOverlayVisible(simpleAlertModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeSimpleAlert();
		return;
	}

	if (isOverlayVisible(timeoutWarningModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		cancelTimeoutWarning();
		return;
	}

	if (isOverlayVisible(disableAgentOrchestrationModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeSessionActionModal(disableAgentOrchestrationModalOverlay);
		return;
	}

	if (isOverlayVisible(resetSessionModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeSessionActionModal(resetSessionModalOverlay);
		return;
	}

	if (isOverlayVisible(newSessionModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeSessionActionModal(newSessionModalOverlay);
		return;
	}

	if (isOverlayVisible(sessionSettingsOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeSessionSettingsModal();
		return;
	}

	if (isOverlayVisible(settingsModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeSettingsModal();
		return;
	}

	if (isOverlayVisible(historyModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		closeHistoryModal();
		return;
	}

	if (isOverlayVisible(changesModalOverlay)) {
		e.preventDefault();
		e.stopPropagation();
		toggleChangesPanel(false);
	}
}

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
	document.addEventListener("keydown", handleGlobalDocumentKeydown);

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
	if (threadBackBtn) {
		threadBackBtn.addEventListener("click", function () {
			if (!agentOrchestrationEnabled) return;
			saveActiveSessionComposerState();
			activeSessionId = null;
			restoreActiveSessionComposerState();
			renderSessionsList();
			updateWelcomeSectionVisibility();
			vscode.postMessage({ type: "switchSession", sessionId: null });
		});
	}
	if (threadSettingsBtn)
		threadSettingsBtn.addEventListener("click", openSessionSettingsModal);
	if (threadResetBtn)
		threadResetBtn.addEventListener("click", function () {
			openResetSessionModal();
		});

	var threadEditBtn = document.getElementById("thread-edit-btn");
	if (threadEditBtn) {
		threadEditBtn.addEventListener("click", function () {
			if (!agentOrchestrationEnabled) return;
			var titleEl = document.getElementById("thread-title");
			if (!titleEl || !activeSessionId) return;
			var currentTitle = titleEl.textContent || "";
			var input = document.createElement("input");
			input.type = "text";
			input.className = "session-rename-input";
			input.value = currentTitle;
			input.maxLength = 50;
			titleEl.replaceWith(input);
			input.focus();
			input.select();

			var committed = false;
			function commit() {
				if (committed) return;
				committed = true;
				var newTitle = input.value.trim();
				var strong = document.createElement("strong");
				strong.id = "thread-title";
				strong.textContent = newTitle || currentTitle;
				input.replaceWith(strong);
				if (newTitle && newTitle !== currentTitle) {
					vscode.postMessage({
						type: "updateSessionTitle",
						sessionId: activeSessionId,
						title: newTitle,
					});
				}
			}

			input.addEventListener("keydown", function (ev) {
				if (ev.key === "Enter") {
					ev.preventDefault();
					commit();
				} else if (ev.key === "Escape") {
					ev.preventDefault();
					committed = true;
					var strong = document.createElement("strong");
					strong.id = "thread-title";
					strong.textContent = currentTitle;
					input.replaceWith(strong);
				}
			});
			input.addEventListener("blur", commit);
		});
	}

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
	if (agentOrchestrationToggle) {
		agentOrchestrationToggle.addEventListener(
			"click",
			toggleAgentOrchestrationSetting,
		);
		agentOrchestrationToggle.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleAgentOrchestrationSetting();
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
		autopilotAddBtn.addEventListener("click", function () {
			workspacePromptListUI.showAddForm();
		});
	}
	if (saveAutopilotPromptBtn) {
		saveAutopilotPromptBtn.addEventListener("click", function () {
			workspacePromptListUI.save();
		});
	}
	if (cancelAutopilotPromptBtn) {
		cancelAutopilotPromptBtn.addEventListener("click", function () {
			workspacePromptListUI.hideAddForm();
		});
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
	if (ssAutoAppendTextInput) {
		ssAutoAppendTextInput.addEventListener("input", ssValidateAutoAppendText);
	}
	if (ssSaveAsDefaultBtn) {
		ssSaveAsDefaultBtn.addEventListener("click", ssSaveAutoAppendAsDefault);
	}
	if (ssAddAutopilotPromptBtn)
		ssAddAutopilotPromptBtn.addEventListener("click", ssShowAddPromptForm);
	if (ssSaveAutopilotPromptBtn)
		ssSaveAutopilotPromptBtn.addEventListener("click", ssSavePrompt);
	if (ssCancelAutopilotPromptBtn)
		ssCancelAutopilotPromptBtn.addEventListener("click", ssHideAddPromptForm);
	// List-level events (click, drag) are bound via initSessionPromptListUI()
}
