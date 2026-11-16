import { eventSource, event_types, isStreamingEnabled } from '/script.js';
import { getCurrentLocale } from '/scripts/i18n.js';
import { oai_settings } from '/scripts/openai.js';
import { getContext } from '/scripts/st-context.js';

const SUPPORTED_BACKGROUND_APIS = new Set([
    'openai',
    'textgenerationwebui',
    'novel',
    'kobold',
]);

const SETTINGS_KEY = 'linshen_ui';
const APPBAR_ID = 'linshen-ui-appbar';
const TASK_STATUS_ID = 'linshen-ui-task-status';
let translations = {};

let appbar;
let taskStatus;
let connectionLabel;
let contextLabel;
let taskTitle;
let taskDescription;
let toolsButton;
let toolsMenu;
let activeSettingsCategory = 'model';
let recoveryJob;
let generationActive = false;
let generationChatKey = '';
const activeServerJobs = new Map();
let terminalStatus;
let terminalTimer;
let recoverableRefreshTimer;
let recoveryRequestId = 0;
const eventHandlers = [];

function copy(englishText) {
    return translations[englishText] || englishText;
}

function getUiSettings() {
    const extensionSettings = getContext().extensionSettings;
    extensionSettings[SETTINGS_KEY] ??= { language: 'system' };

    if (!['system', 'zh-cn', 'en'].includes(extensionSettings[SETTINGS_KEY].language)) {
        extensionSettings[SETTINGS_KEY].language = 'system';
    }

    return extensionSettings[SETTINGS_KEY];
}

function getSelectedLanguage() {
    const setting = getUiSettings().language;
    if (setting !== 'system') {
        return setting;
    }

    const systemLocale = navigator.languages?.find(Boolean) || navigator.language || getCurrentLocale() || 'en';
    return /^zh(?:-|$)/i.test(systemLocale) ? 'zh-cn' : 'en';
}

async function loadTranslations() {
    translations = {};
    if (getSelectedLanguage() !== 'zh-cn') {
        return;
    }

    try {
        const response = await fetch(new URL('./i18n/zh-cn.json', import.meta.url), { cache: 'no-cache' });
        if (response.ok) {
            translations = await response.json();
        }
    } catch {
        // English source text remains available if the optional locale file cannot load.
    }
}

function getChatKey(context = getContext()) {
    if (!context.chatId) {
        return '';
    }

    if (context.groupId) {
        return `group:${context.groupId}:${context.chatId}`;
    }

    const character = context.characters[context.characterId];
    return `character:${character?.avatar || ''}:${context.chatId}`;
}

function getProviderName(api) {
    switch (api) {
        case 'openai':
            return copy('Chat Completions');
        case 'textgenerationwebui':
            return copy('Text Generation WebUI');
        case 'novel':
            return copy('NovelAI');
        case 'kobold':
            return copy('Kobold');
        case 'horde':
            return copy('Horde');
        default:
            return api || copy('No model selected');
    }
}

function createAppbar() {
    const topBar = document.getElementById('top-bar');
    if (!topBar) {
        return;
    }

    appbar = document.getElementById(APPBAR_ID);
    if (appbar) {
        return;
    }

    appbar = document.createElement('div');
    appbar.id = APPBAR_ID;
    appbar.className = 'linshen-appbar';
    appbar.setAttribute('role', 'group');
    appbar.setAttribute('aria-label', copy('Linshen interface controls'));
    appbar.innerHTML = `
        <div class="linshen-brand">
            <span class="linshen-brand-mark" aria-hidden="true"><i class="fa-solid fa-leaf"></i></span>
            <span class="linshen-brand-name">林深时见鹿</span>
        </div>
        <span class="linshen-rail-divider" aria-hidden="true"></span>
        <button type="button" id="linshen-context-button" class="linshen-context-button" title="${copy('Open World Book settings')}" aria-label="${copy('Open World Book settings')}">
            <i class="fa-solid fa-book-atlas linshen-context-icon" aria-hidden="true"></i>
            <strong id="linshen-context-label"></strong>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="linshen-tools">
            <button type="button" id="linshen-tools-button" class="linshen-tools-button" title="${copy('Open tools and settings')}" aria-label="${copy('Open tools and settings')}" aria-haspopup="dialog" aria-expanded="false" aria-controls="linshen-tools-menu">
                <i class="fa-solid fa-grip" aria-hidden="true"></i>
                <span>${copy('Tools & settings')}</span>
            </button>
        </div>
        <button type="button" id="linshen-connection-button" class="linshen-connection-button" title="${copy('Open API connections')}" aria-label="${copy('Open API connections')}">
            <span class="linshen-connection-indicator" aria-hidden="true"></span>
            <span id="linshen-connection-label"></span>
        </button>
    `;

    topBar.append(appbar);
    contextLabel = appbar.querySelector('#linshen-context-label');
    connectionLabel = appbar.querySelector('#linshen-connection-label');
    toolsButton = appbar.querySelector('#linshen-tools-button');

    appbar.querySelector('#linshen-context-button')?.addEventListener('click', () => {
        document.getElementById('WIDrawerIcon')?.click();
    });
    toolsButton?.addEventListener('click', () => {
        setToolsMenuOpen(toolsMenu?.hidden === true, true);
    });
    appbar.querySelector('#linshen-connection-button')?.addEventListener('click', () => {
        document.getElementById('API-status-top')?.click();
    });
}

function createSettingsDialog() {
    toolsMenu = document.getElementById('linshen-tools-menu');
    if (toolsMenu) {
        return;
    }

    toolsMenu = document.createElement('div');
    toolsMenu.id = 'linshen-tools-menu';
    toolsMenu.className = 'linshen-dialog-backdrop';
    toolsMenu.hidden = true;
    toolsMenu.innerHTML = `
        <section class="linshen-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="linshen-settings-title">
            <header class="linshen-dialog-header">
                <div>
                    <span class="linshen-dialog-brand">林深时见鹿</span>
                    <h2 id="linshen-settings-title">${copy('Tools & settings')}</h2>
                </div>
                <button type="button" class="linshen-dialog-close" data-linshen-close aria-label="${copy('Close settings')}" title="${copy('Close settings')}">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <div class="linshen-dialog-layout">
                <nav class="linshen-category-nav" role="tablist" aria-label="${copy('Settings categories')}" aria-orientation="vertical">
                    <button type="button" class="linshen-category-tab" id="linshen-tab-model" role="tab" aria-selected="true" aria-controls="linshen-panel-model" tabindex="0" data-linshen-category="model">
                        <i class="fa-solid fa-sliders" aria-hidden="true"></i><span>${copy('Model')}</span>
                    </button>
                    <button type="button" class="linshen-category-tab" id="linshen-tab-context" role="tab" aria-selected="false" aria-controls="linshen-panel-context" tabindex="-1" data-linshen-category="context">
                        <i class="fa-solid fa-book-open" aria-hidden="true"></i><span>${copy('Context')}</span>
                    </button>
                    <button type="button" class="linshen-category-tab" id="linshen-tab-workspace" role="tab" aria-selected="false" aria-controls="linshen-panel-workspace" tabindex="-1" data-linshen-category="workspace">
                        <i class="fa-solid fa-images" aria-hidden="true"></i><span>${copy('Workspace')}</span>
                    </button>
                    <button type="button" class="linshen-category-tab" id="linshen-tab-settings" role="tab" aria-selected="false" aria-controls="linshen-panel-settings" tabindex="-1" data-linshen-category="settings">
                        <i class="fa-solid fa-gear" aria-hidden="true"></i><span>${copy('Settings')}</span>
                    </button>
                </nav>
                <div class="linshen-settings-content">
                    <section class="linshen-settings-panel" id="linshen-panel-model" role="tabpanel" aria-labelledby="linshen-tab-model" data-linshen-panel="model">
                        <h3>${copy('Model')}</h3>
                        <div class="linshen-settings-actions">
                            <button type="button" data-linshen-target="#leftNavDrawerIcon"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>${copy('Response settings')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                            <button type="button" data-linshen-target="#API-status-top"><i class="fa-solid fa-plug" aria-hidden="true"></i><span>${copy('API connection')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                        </div>
                    </section>
                    <section class="linshen-settings-panel" id="linshen-panel-context" role="tabpanel" aria-labelledby="linshen-tab-context" data-linshen-panel="context" hidden>
                        <h3>${copy('Context')}</h3>
                        <div class="linshen-settings-actions">
                            <button type="button" data-linshen-target="#advanced-formatting-button .drawer-icon"><i class="fa-solid fa-font" aria-hidden="true"></i><span>${copy('Formatting')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                            <button type="button" data-linshen-target="#WIDrawerIcon"><i class="fa-solid fa-book-atlas" aria-hidden="true"></i><span>${copy('World Info')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                            <button type="button" data-linshen-target="#persona-management-button .drawer-icon"><i class="fa-solid fa-face-smile" aria-hidden="true"></i><span>${copy('Personas')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                        </div>
                    </section>
                    <section class="linshen-settings-panel" id="linshen-panel-workspace" role="tabpanel" aria-labelledby="linshen-tab-workspace" data-linshen-panel="workspace" hidden>
                        <h3>${copy('Workspace')}</h3>
                        <div class="linshen-settings-actions">
                            <button type="button" data-linshen-target="#backgrounds-drawer-toggle"><i class="fa-solid fa-image" aria-hidden="true"></i><span>${copy('Appearance')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                            <button type="button" data-linshen-target="#extensions-settings-button .drawer-icon"><i class="fa-solid fa-cubes" aria-hidden="true"></i><span>${copy('Extensions')}</span><i class="fa-solid fa-arrow-up-right-from-square linshen-action-arrow" aria-hidden="true"></i></button>
                        </div>
                    </section>
                    <section class="linshen-settings-panel" id="linshen-panel-settings" role="tabpanel" aria-labelledby="linshen-tab-settings" data-linshen-panel="settings" hidden>
                        <h3>${copy('Settings')}</h3>
                        <div class="linshen-language-setting">
                            <label for="linshen-ui-language">${copy('Interface language')}</label>
                            <p>${copy('Changes are saved automatically.')}</p>
                            <select id="linshen-ui-language">
                                <option value="system">${copy('Follow system')}</option>
                                <option value="zh-cn">${copy('Simplified Chinese')}</option>
                                <option value="en">${copy('English')}</option>
                            </select>
                        </div>
                    </section>
                </div>
            </div>
        </section>
    `;

    document.body.append(toolsMenu);
    toolsMenu.addEventListener('click', onToolsMenuClick);
    toolsMenu.querySelector('#linshen-ui-language')?.addEventListener('change', onLanguageChange);
    setActiveSettingsCategory(activeSettingsCategory);
}

async function onLanguageChange(event) {
    const language = event.currentTarget.value;
    if (!['system', 'zh-cn', 'en'].includes(language)) {
        return;
    }

    const context = getContext();
    context.extensionSettings[SETTINGS_KEY].language = language;
    context.saveSettingsDebounced();

    const menuWasOpen = toolsMenu && !toolsMenu.hidden;
    const languageHadFocus = document.activeElement?.id === 'linshen-ui-language';
    const selectedCategory = toolsMenu?.querySelector('[role="tab"][aria-selected="true"]')?.dataset.linshenCategory || activeSettingsCategory;
    await loadTranslations();

    toolsMenu?.remove();
    appbar?.remove();
    appbar = null;
    toolsMenu = null;
    toolsButton = null;
    createAppbar();
    createSettingsDialog();
    updateHeader();
    renderTaskStatus();

    if (menuWasOpen) {
        setToolsMenuOpen(true);
        setActiveSettingsCategory(selectedCategory);
        if (languageHadFocus) {
            toolsMenu?.querySelector('#linshen-ui-language')?.focus();
        }
    }
}

function setActiveSettingsCategory(category, focus = false) {
    if (!toolsMenu) {
        return;
    }

    const tab = toolsMenu.querySelector(`[role="tab"][data-linshen-category="${category}"]`);
    if (!tab) {
        return;
    }

    activeSettingsCategory = category;
    for (const item of toolsMenu.querySelectorAll('[role="tab"]')) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
    }
    for (const panel of toolsMenu.querySelectorAll('[data-linshen-panel]')) {
        panel.hidden = panel.dataset.linshenPanel !== category;
    }
    if (focus) {
        tab.focus();
    }
}

function setToolsMenuOpen(open, focusFirst = false, restoreFocus = true) {
    if (!toolsButton || !toolsMenu) {
        return;
    }

    toolsMenu.hidden = !open;
    toolsButton.setAttribute('aria-expanded', String(open));
    if (open && focusFirst) {
        toolsMenu.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    } else if (!open && restoreFocus) {
        toolsButton.focus();
    }
}

function onToolsMenuClick(event) {
    const targetElement = event.target instanceof Element ? event.target : null;
    if (!targetElement) {
        return;
    }

    if (targetElement === toolsMenu) {
        setToolsMenuOpen(false);
        return;
    }

    const categoryTab = targetElement.closest('[role="tab"][data-linshen-category]');
    if (categoryTab) {
        setActiveSettingsCategory(categoryTab.dataset.linshenCategory);
        return;
    }

    if (targetElement.closest('[data-linshen-close]')) {
        setToolsMenuOpen(false);
        return;
    }

    const button = targetElement.closest('button[data-linshen-target]');
    if (!button) {
        return;
    }

    const target = document.querySelector(button.dataset.linshenTarget);
    setToolsMenuOpen(false, false, false);
    target?.click();
}

function onToolsMenuKeydown(event) {
    if (!toolsMenu || toolsMenu.hidden) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        setToolsMenuOpen(false);
        return;
    }

    const categoryTab = event.target.closest?.('[role="tab"][data-linshen-category]');
    if (categoryTab && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const tabs = [...toolsMenu.querySelectorAll('[role="tab"]')];
        const currentIndex = tabs.indexOf(categoryTab);
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? tabs.length - 1
                : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        setActiveSettingsCategory(tabs[nextIndex].dataset.linshenCategory, true);
        return;
    }

    if (event.key === 'Tab') {
        const focusable = [...toolsMenu.querySelectorAll('button:not([disabled]), select:not([disabled])')]
            .filter(element => element.tabIndex >= 0 && !element.closest('[hidden]'));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }
}

function createTaskStatus() {
    const formShell = document.getElementById('form_sheld');
    const sendForm = document.getElementById('send_form');
    if (!formShell || !sendForm) {
        return;
    }

    taskStatus = document.getElementById(TASK_STATUS_ID);
    if (taskStatus) {
        return;
    }

    taskStatus = document.createElement('section');
    taskStatus.id = TASK_STATUS_ID;
    taskStatus.className = 'linshen-task-status';
    taskStatus.hidden = true;
    taskStatus.setAttribute('role', 'status');
    taskStatus.setAttribute('aria-live', 'polite');
    taskStatus.setAttribute('aria-atomic', 'true');
    taskStatus.innerHTML = `
        <span class="linshen-task-mark" aria-hidden="true"><span></span></span>
        <span class="linshen-task-copy">
            <strong class="linshen-task-title"></strong>
            <span class="linshen-task-description"></span>
        </span>
    `;

    formShell.insertBefore(taskStatus, sendForm);
    taskTitle = taskStatus.querySelector('.linshen-task-title');
    taskDescription = taskStatus.querySelector('.linshen-task-description');
}

function updateHeader() {
    const context = getContext();
    if (!appbar || !contextLabel || !connectionLabel) {
        return;
    }

    const worldInfoSelect = document.getElementById('world_info');
    const selectedWorldBooks = worldInfoSelect
        ? [...worldInfoSelect.selectedOptions]
            .filter(option => option.value)
            .map(option => option.textContent.trim())
            .filter(Boolean)
        : [];
    contextLabel.textContent = selectedWorldBooks.length > 1
        ? selectedWorldBooks[0] + ' +' + (selectedWorldBooks.length - 1)
        : selectedWorldBooks[0] || copy('Choose a World Book');

    const provider = getProviderName(context.mainApi);

    if (!navigator.onLine) {
        connectionLabel.textContent = copy('Browser offline');
        appbar.dataset.connection = 'offline';
    } else if (context.onlineStatus === 'no_connection') {
        connectionLabel.textContent = context.mainApi ? copy('Waiting for connection') : copy('Not connected');
        appbar.dataset.connection = context.mainApi ? 'waiting' : 'empty';
    } else {
        connectionLabel.textContent = copy('Connected');
        appbar.dataset.connection = 'connected';
    }

    const contextButton = appbar.querySelector('#linshen-context-button');
    contextButton?.setAttribute('aria-label', `${copy('Open World Book settings')}: ${contextLabel.textContent}`);
    const connectionButton = appbar.querySelector('#linshen-connection-button');
    connectionButton?.setAttribute('aria-label', `${copy('Open API connections')}: ${connectionLabel.textContent}: ${provider}`);
    connectionButton?.setAttribute('title', `${copy('Open API connections')}: ${provider}`);
}

function setTaskStatus(state, title, description) {
    if (!taskStatus || !taskTitle || !taskDescription) {
        return;
    }

    if (!state) {
        taskStatus.hidden = true;
        taskStatus.removeAttribute('data-state');
        return;
    }

    taskStatus.hidden = false;
    taskStatus.dataset.state = state;
    taskTitle.textContent = title;
    taskDescription.textContent = description;
}

function getVisibleTaskStatus() {
    const context = getContext();
    const currentChatKey = getChatKey(context);
    const activeJobChatKeys = [...activeServerJobs.values()];

    if (!navigator.onLine) {
        if (currentChatKey && activeJobChatKeys.includes(currentChatKey)) {
            return {
                state: 'offline-running',
                title: copy('Browser disconnected'),
                description: copy('The server task will continue. The answer can be received after reconnecting.'),
            };
        }

        return {
            state: 'offline',
            title: copy('Connection lost'),
            description: copy('Reconnect to the server to continue this chat.'),
        };
    }

    if (recoveryJob && recoveryJob.chatKey === currentChatKey) {
        if (recoveryJob.status === 'interrupted') {
            return {
                state: 'interrupted',
                title: copy('The server restarted'),
                description: copy('Only the response saved before the restart can be restored.'),
            };
        }

        if (recoveryJob.status === 'complete') {
            return {
                state: 'ready',
                title: copy('A response is ready to receive'),
                description: copy('Accept the recovery prompt to add the saved answer to this chat.'),
            };
        }

        return {
            state: 'ready',
            title: copy('An unfinished response was found'),
            description: copy('Accept the recovery prompt to continue receiving the answer.'),
        };
    }

    if (currentChatKey && activeJobChatKeys.includes(currentChatKey)) {
        return {
            state: 'running',
            title: copy('Generating on the server'),
            description: copy('This task can continue while the page is closed, as long as the server stays running.'),
        };
    }

    if (activeJobChatKeys.length > 0 && !activeJobChatKeys.includes(currentChatKey)) {
        return {
            state: 'other-chat',
            title: copy('A task is running in another chat'),
            description: copy('Switch back to that chat to follow its response.'),
        };
    }

    if (generationActive && generationChatKey === currentChatKey) {
        const context = getContext();
        if (context.mainApi === 'horde') {
            return {
                state: 'foreground',
                title: copy('Generating with Horde'),
                description: copy('Keep this page open. Horde generation does not use background jobs yet.'),
            };
        }

        return {
            state: 'starting',
            title: copy('Starting generation'),
            description: copy('Connecting to the model and preparing the response stream.'),
        };
    }

    if (terminalStatus && terminalStatus.chatKey === currentChatKey && terminalStatus.expiresAt > Date.now()) {
        return terminalStatus;
    }

    return null;
}

function renderTaskStatus() {
    const state = getVisibleTaskStatus();
    setTaskStatus(state?.state, state?.title, state?.description);
}

async function refreshRecoverableJob() {
    const context = getContext();
    const chatKey = getChatKey(context);
    const requestId = ++recoveryRequestId;

    if (!chatKey || !context.getRequestHeaders) {
        recoveryJob = null;
        renderTaskStatus();
        return;
    }

    try {
        const response = await fetch('/api/generation-jobs/recoverable', {
            method: 'GET',
            headers: context.getRequestHeaders(),
            cache: 'no-store',
        });

        if (!response.ok) {
            return;
        }

        const jobs = await response.json();
        if (requestId !== recoveryRequestId || getChatKey() !== chatKey || !Array.isArray(jobs)) {
            return;
        }

        const alreadyDelivered = new Set(
            context.chat
                .map(message => message?.extra?.generation_job_id)
                .filter(Boolean),
        );
        const currentCompletionSource = String(
            context.mainApi === 'openai'
                ? oai_settings.chat_completion_source
                : context.mainApi || '',
        );
        const currentStreaming = Boolean(isStreamingEnabled());
        const match = jobs
            .filter(job => job.metadata?.chatKey === chatKey)
            .filter(job => job.metadata?.mainApi === context.mainApi)
            .filter(job => job.metadata?.completionSource === currentCompletionSource)
            .filter(job => job.metadata?.stream === currentStreaming)
            .filter(job => !['quiet', 'impersonate'].includes(job.metadata?.generationType))
            .filter(job => SUPPORTED_BACKGROUND_APIS.has(job.metadata?.mainApi))
            .filter(job => !alreadyDelivered.has(job.id))
            .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];

        recoveryJob = match ? { ...match, chatKey } : null;
        renderTaskStatus();
    } catch (error) {
        console.debug('DeerTavern UI could not refresh recoverable generation jobs:', error);
    }
}

function onGenerationStarted(generationType, _args, isDryRun) {
    if (isDryRun || ['quiet', 'impersonate'].includes(String(generationType))) {
        return;
    }

    const context = getContext();
    generationActive = true;
    generationChatKey = getChatKey(context);
    recoveryJob = null;
    terminalStatus = null;
    window.clearTimeout(terminalTimer);
    terminalTimer = undefined;
    window.clearTimeout(recoverableRefreshTimer);
    recoverableRefreshTimer = undefined;
    renderTaskStatus();
}

function onGenerationJobStarted(event) {
    const id = event?.detail?.id;
    if (!id) {
        return;
    }

    activeServerJobs.set(id, generationChatKey || getChatKey());
    recoveryJob = null;
    renderTaskStatus();
}

function finishGeneration(state, title, description) {
    const chatKey = generationChatKey || getChatKey();
    generationActive = false;
    generationChatKey = '';
    const finishedJob = [...activeServerJobs.entries()].find(([, jobChatKey]) => jobChatKey === chatKey);
    if (finishedJob) {
        activeServerJobs.delete(finishedJob[0]);
    }
    terminalStatus = {
        state,
        title,
        description,
        chatKey,
        expiresAt: Date.now() + 3500,
    };

    window.clearTimeout(terminalTimer);
    terminalTimer = window.setTimeout(() => {
        terminalTimer = undefined;
        terminalStatus = null;
        renderTaskStatus();
    }, 3500);

    renderTaskStatus();
    window.clearTimeout(recoverableRefreshTimer);
    recoverableRefreshTimer = window.setTimeout(() => {
        recoverableRefreshTimer = undefined;
        void refreshRecoverableJob();
    }, 1000);
}

function onGenerationEnded() {
    finishGeneration('complete', copy('Response added to chat'), copy('The answer is saved with this conversation.'));
}

function onGenerationStopped() {
    finishGeneration('stopped', copy('Generation stopped'), copy('The server task was asked to stop.'));
}

function onChatChanged() {
    updateHeader();
    renderTaskStatus();
    void refreshRecoverableJob();
}

function onOnline() {
    updateHeader();
    renderTaskStatus();
    void refreshRecoverableJob();
}

function onOffline() {
    updateHeader();
    renderTaskStatus();
}

function addEventListener(source, eventName, handler) {
    source.on(eventName, handler);
    eventHandlers.push({ source, eventName, handler });
}

export async function init() {
    if (document.body.classList.contains('linshen-ui-enabled')) {
        return;
    }

    await loadTranslations();
    document.body.classList.add('linshen-ui-enabled');
    createAppbar();
    createSettingsDialog();
    createTaskStatus();
    updateHeader();
    renderTaskStatus();

    document.addEventListener('keydown', onToolsMenuKeydown);
    addEventListener(eventSource, event_types.WORLDINFO_SETTINGS_UPDATED, updateHeader);
    addEventListener(eventSource, event_types.APP_READY, () => {
        updateHeader();
        void refreshRecoverableJob();
    });
    addEventListener(eventSource, event_types.CHAT_CHANGED, onChatChanged);
    addEventListener(eventSource, event_types.GENERATION_STARTED, onGenerationStarted);
    addEventListener(eventSource, event_types.GENERATION_ENDED, onGenerationEnded);
    addEventListener(eventSource, event_types.GENERATION_STOPPED, onGenerationStopped);
    addEventListener(eventSource, event_types.ONLINE_STATUS_CHANGED, () => {
        updateHeader();
        renderTaskStatus();
        void refreshRecoverableJob();
    });
    addEventListener(eventSource, event_types.MAIN_API_CHANGED, () => {
        updateHeader();
        void refreshRecoverableJob();
    });

    window.addEventListener('st-generation-job-started', onGenerationJobStarted);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    void refreshRecoverableJob();
}

export function cleanup() {
    for (const { source, eventName, handler } of eventHandlers.splice(0)) {
        source.removeListener(eventName, handler);
    }

    window.removeEventListener('st-generation-job-started', onGenerationJobStarted);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('keydown', onToolsMenuKeydown);
    window.clearTimeout(terminalTimer);
    window.clearTimeout(recoverableRefreshTimer);
    recoveryRequestId++;
    document.getElementById(APPBAR_ID)?.remove();
    document.getElementById('linshen-tools-menu')?.remove();
    document.getElementById(TASK_STATUS_ID)?.remove();
    document.body.classList.remove('linshen-ui-enabled');

    appbar = null;
    taskStatus = null;
    toolsButton = null;
    toolsMenu = null;
    connectionLabel = null;
    contextLabel = null;
    taskTitle = null;
    taskDescription = null;
    recoveryJob = null;
    generationActive = false;
    generationChatKey = '';
    activeServerJobs.clear();
    terminalStatus = null;
    terminalTimer = undefined;
    recoverableRefreshTimer = undefined;
    activeSettingsCategory = 'model';
}
