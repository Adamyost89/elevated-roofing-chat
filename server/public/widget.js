(function () {
  'use strict';

  var BASE = (function () {
    var script = document.currentScript;
    var src = script && script.src;
    if (src) {
      var a = document.createElement('a');
      a.href = src;
      return a.origin + a.pathname.replace(/\/[^/]+$/, '');
    }
    return window.ER_CHAT_BASE_URL || '';
  })();
  if (!BASE && typeof window !== 'undefined' && window.location) BASE = window.location.origin;
  if (!BASE) {
    console.warn('Elevated Roofing Chat: could not detect base URL. Set window.ER_CHAT_BASE_URL.');
    return;
  }

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = BASE + '/widget.css';
  document.head.appendChild(link);

  var root = document.createElement('div');
  root.id = 'er-chat-root';
  document.body.appendChild(root);

  var conversationId = null;
  var visitorId = null;
  var ws = null;
  var settings = {
    delay_seconds: 3,
    chatbox_popup_delay_seconds: 10,
    welcome_text: 'Hi! How can we help you today?',
    primary_color: '#2563eb',
    position: 'bottom-right',
    button_always_visible: true,
    button_style: 'icon_only',
    button_label: 'Chat',
    header_title: 'Chat with us',
    input_placeholder: 'Type a message...',
    show_agent_name: true,
    sound_enabled: true,
    agent_display_names: {},
    agent_avatar_urls: {},
    followup_enabled: true,
    followup_delay_minutes: 2,
    followup_title: "We'll get back to you",
    followup_message: 'Leave your name and email or phone so we can reach you.',
    followup_name_placeholder: 'Name',
    followup_email_placeholder: 'Email',
    followup_phone_placeholder: 'Phone',
    followup_submit_label: 'Send',
    ooo_enabled: false,
    ooo_timezone: 'America/Chicago',
    ooo_schedule: null,
    ooo_contact_form_delay_seconds: 0,
    ooo_message: "We're currently out of office. Leave your details and we'll get back to you.",
    contact_form_fields: [
      { id: 'name', type: 'text', label: 'Name', placeholder: 'Name', required: false },
      { id: 'email', type: 'email', label: 'Email', placeholder: 'Email', required: true },
      { id: 'phone', type: 'tel', label: 'Phone', placeholder: 'Phone', required: false }
    ],
    waiting_status_text: 'Waiting on team member',
    waiting_prompt_delay_seconds: 120,
    waiting_prompt_question: 'Would you like to keep waiting or have someone contact you?',
    waiting_prompt_keep_label: 'Keep waiting',
    waiting_prompt_contact_label: 'Have someone contact me'
  };
  var lastShownAgentKey = null;
  var autoOpenTimer = null;
  var windowIsOpen = false;
  var followupTimer = null;
  var oooFormTimer = null;
  var waitingPromptTimer = null;
  var waitingPromptShown = false;
  var contactSubmitted = false;
  var hasAgentReplied = false;
  var unreadCount = 0;
  var SESSION_CLOSE_KEY = 'er_chat_closed_session';

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function isMobileDevice() {
    try {
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return true;
      var ua = (navigator && navigator.userAgent) || '';
      var touchCapable = ('ontouchstart' in window) || (navigator && navigator.maxTouchPoints > 0);
      return /android|iphone|ipad|ipod|mobile/i.test(ua) || touchCapable;
    } catch (e) {
      return false;
    }
  }

  function isClosedForSession() {
    try {
      return sessionStorage.getItem(SESSION_CLOSE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function markClosedForSession() {
    try {
      sessionStorage.setItem(SESSION_CLOSE_KEY, '1');
    } catch (e) {}
  }

  function updateLauncherBadge() {
    var launcher = root.querySelector('.er-chat-launcher');
    if (!launcher) return;
    var badge = launcher.querySelector('.er-chat-launcher-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'er-chat-launcher-badge';
      launcher.appendChild(badge);
    }
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
      badge.style.display = 'inline-flex';
      launcher.setAttribute('aria-label', (settings.button_label || 'Open chat') + ' (' + unreadCount + ' unread)');
    } else {
      badge.style.display = 'none';
      launcher.setAttribute('aria-label', settings.button_label || 'Open chat');
    }
  }

  function loadSettings(cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', BASE + '/api/widget-settings', true);
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var s = JSON.parse(xhr.responseText);
          settings.delay_seconds = s.delay_seconds != null ? s.delay_seconds : 3;
          settings.chatbox_popup_delay_seconds = Math.max(0, parseInt(s.chatbox_popup_delay_seconds, 10) || 10);
          settings.welcome_text = s.welcome_text || settings.welcome_text;
          settings.primary_color = s.primary_color || settings.primary_color;
          settings.position = s.position || 'bottom-right';
          settings.button_always_visible = s.button_always_visible !== false;
          settings.button_style = s.button_style || 'icon_only';
          settings.button_label = s.button_label || 'Chat';
          settings.header_title = s.header_title || 'Chat with us';
          settings.input_placeholder = s.input_placeholder || 'Type a message...';
          settings.show_agent_name = s.show_agent_name !== false;
          settings.sound_enabled = s.sound_enabled !== false && s.sound_enabled !== '0';
          settings.agent_display_names = s.agent_display_names || {};
          settings.agent_avatar_urls = s.agent_avatar_urls || {};
          settings.followup_enabled = s.followup_enabled !== false;
          settings.followup_delay_minutes = Math.max(1, parseInt(s.followup_delay_minutes, 10) || 2);
          settings.followup_title = s.followup_title || settings.followup_title;
          settings.followup_message = s.followup_message || settings.followup_message;
          settings.followup_name_placeholder = s.followup_name_placeholder || 'Name';
          settings.followup_email_placeholder = s.followup_email_placeholder || 'Email';
          settings.followup_phone_placeholder = s.followup_phone_placeholder || 'Phone';
          settings.followup_submit_label = s.followup_submit_label || 'Send';
          settings.ooo_enabled = s.ooo_enabled === true || s.ooo_enabled === '1';
          settings.ooo_timezone = s.ooo_timezone || 'America/Chicago';
          settings.ooo_schedule = s.ooo_schedule || null;
          settings.ooo_contact_form_delay_seconds = Math.max(0, parseInt(s.ooo_contact_form_delay_seconds, 10) || 0);
          settings.ooo_message = s.ooo_message || "We're currently out of office. Leave your details and we'll get back to you.";
          if (Array.isArray(s.contact_form_fields) && s.contact_form_fields.length > 0) {
            settings.contact_form_fields = s.contact_form_fields;
          }
          settings.waiting_status_text = s.waiting_status_text || 'Waiting on team member';
          settings.waiting_prompt_delay_seconds = Math.max(0, parseInt(s.waiting_prompt_delay_seconds, 10) || 120);
          settings.waiting_prompt_question = s.waiting_prompt_question || 'Would you like to keep waiting or have someone contact you?';
          settings.waiting_prompt_keep_label = s.waiting_prompt_keep_label || 'Keep waiting';
          settings.waiting_prompt_contact_label = s.waiting_prompt_contact_label || 'Have someone contact me';
        } catch (e) {}
      }
      if (typeof cb === 'function') cb();
    };
    xhr.send();
  }

  function ensureConversation(cb) {
    if (conversationId && visitorId) {
      if (typeof cb === 'function') cb();
      return;
    }
    visitorId = getCookie('chat_visitor_id') || null;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/conversations', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          conversationId = d.conversation_id;
          visitorId = d.visitor_id;
        } catch (e) {}
      }
      if (typeof cb === 'function') cb();
    };
    xhr.send(JSON.stringify({ visitor_id: visitorId }));
  }

  function playNotificationSound() {
    if (!settings.sound_enabled) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      var ctx = new C();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  var typingTimeout = null;
  var typingDebounceTimer = null;
  var composingTimer = null;
  var lastComposingSend = 0;
  var COMPOSING_THROTTLE_MS = 120;

  function connectWs() {
    if (!conversationId) return;
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = (BASE.match(/^https?:\/\/([^/]+)/) || [])[1] || window.location.host;
    var url = proto + '//' + host + '/ws?conversation_id=' + encodeURIComponent(conversationId) + '&role=visitor';
    try {
      ws = new WebSocket(url);
      ws.onmessage = function (ev) {
        try {
          var p = JSON.parse(ev.data);
          if (p.type === 'new_message' && p.message && p.message.sender_type === 'agent') {
            playNotificationSound();
            if (!windowIsOpen) {
              unreadCount += 1;
              updateLauncherBadge();
            }
            appendMessage(p.message);
            hideTypingIndicator();
          } else if (p.type === 'typing' && p.role === 'agent') {
            showTypingIndicator();
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  function showTypingIndicator() {
    var el = root.querySelector('.er-chat-typing');
    if (el) {
      el.style.display = 'block';
    } else {
      el = document.createElement('div');
      el.className = 'er-chat-typing';
      el.textContent = 'Team member is typing...';
      var list = root.querySelector('.er-chat-messages');
      if (list) list.appendChild(el);
    }
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(hideTypingIndicator, 3000);
  }

  function hideTypingIndicator() {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
    var el = root.querySelector('.er-chat-typing');
    if (el) el.style.display = 'none';
  }

  function sendTyping() {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'typing', role: 'visitor' }));
      } catch (e) {}
    }
  }

  function sendComposing(text) {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'composing', role: 'visitor', text: text || '' }));
      } catch (e) {}
    }
  }

  function scheduleComposingSend() {
    var now = Date.now();
    if (composingTimer) return;
    var elapsed = now - lastComposingSend;
    var delay = elapsed >= COMPOSING_THROTTLE_MS ? 0 : COMPOSING_THROTTLE_MS - elapsed;
    composingTimer = setTimeout(function () {
      composingTimer = null;
      lastComposingSend = Date.now();
      var input = root.querySelector('.er-chat-input');
      var val = input ? input.value : '';
      sendComposing(val);
    }, delay);
  }

  function getAgentDisplayName(email) {
    if (!email || !settings.agent_display_names) return null;
    var key = (email || '').toLowerCase();
    return settings.agent_display_names[key] || settings.agent_display_names[email] || null;
  }

  function getAgentAvatarUrl(email) {
    if (!email || !settings.agent_avatar_urls) return null;
    var key = (email || '').toLowerCase();
    return settings.agent_avatar_urls[key] || settings.agent_avatar_urls[email] || null;
  }

  function isOutOfOffice() {
    if (!settings.ooo_enabled || !settings.ooo_schedule) return false;
    try {
      var now = new Date();
      var tz = settings.ooo_timezone || 'America/Chicago';
      var dayPart = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(now);
      var dayKey = dayPart.toLowerCase();
      var slot = settings.ooo_schedule[dayKey];
      if (slot == null || (typeof slot === 'object' && slot.start == null)) return true;
      var timePart = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(now);
      var current = timePart.replace(':', '');
      var start = (slot.start || '').replace(':', '');
      var end = (slot.end || '').replace(':', '');
      if (!start || !end) return true;
      return current < start || current >= end;
    } catch (e) {
      return false;
    }
  }

  function appendMessage(msg) {
    var list = root.querySelector('.er-chat-messages');
    if (!list) return;
    if (msg.id && list.querySelector('[data-msg-id="' + msg.id + '"]')) return;
    if (msg.sender_type === 'agent' && settings.show_agent_name) {
      var raw = (msg.agent_email || '').toLowerCase();
      var mapped = getAgentDisplayName(raw) || getAgentDisplayName(msg.agent_email);
      var label = mapped || (msg.agent_email ? String(msg.agent_email).split('@')[0] : '') || 'our team';
      var key = raw || label.toLowerCase();
      if (label && key !== lastShownAgentKey) {
        lastShownAgentKey = key;
        var joined = document.createElement('div');
        joined.className = 'er-chat-agent-joined';
        var avatarUrl = getAgentAvatarUrl(msg.agent_email || raw);
        if (avatarUrl) {
          var img = document.createElement('img');
          img.className = 'er-chat-agent-avatar';
          img.src = avatarUrl;
          img.alt = '';
          joined.appendChild(img);
        }
        var text = document.createElement('span');
        text.className = 'er-chat-agent-joined-text';
        text.textContent = 'Now chatting with ' + label;
        joined.appendChild(text);
        list.appendChild(joined);
      }
    }
    var div = document.createElement('div');
    if (msg.id) div.setAttribute('data-msg-id', String(msg.id));
    div.className = 'er-chat-msg ' + (msg.sender_type === 'agent' ? 'agent' : 'visitor');
    div.style.backgroundColor = msg.sender_type === 'agent' ? settings.primary_color : '';
    div.innerHTML = '<span class="er-chat-msg-text"></span><span class="er-chat-msg-time"></span>';
    div.querySelector('.er-chat-msg-text').textContent = msg.body || '';
    var dt = msg.created_at ? new Date(String(msg.created_at).replace(' ', 'T') + 'Z') : null;
    div.querySelector('.er-chat-msg-time').textContent = dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function loadMessages() {
    if (!conversationId) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', BASE + '/api/conversations/' + encodeURIComponent(conversationId) + '/messages', true);
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          var list = root.querySelector('.er-chat-messages');
          if (list) {
            var welcomeMsg = isOutOfOffice() ? (settings.ooo_message || '') : (settings.welcome_text || '');
            list.innerHTML = '<div class="er-chat-welcome">' + (welcomeMsg || '').replace(/</g, '&lt;') + '</div>';
            lastShownAgentKey = null;
            (d.messages || []).forEach(appendMessage);
            var agentMsgs = (d.messages || []).filter(function(m) { return m.sender_type === 'agent' && m.agent_email; });
            if (agentMsgs.length > 0) {
              var last = (agentMsgs[agentMsgs.length - 1].agent_email || '').toLowerCase();
              lastShownAgentKey = last || null;
              hasAgentReplied = true;
            }
            if ((d.messages || []).length > 0) {
              var w = list.querySelector('.er-chat-welcome');
              if (w) w.style.display = 'none';
            }
            var lastMsg = (d.messages || [])[(d.messages || []).length - 1];
            if (lastMsg && lastMsg.sender_type === 'visitor' && !contactSubmitted && !hasAgentReplied) {
              showWaitingStatus();
              scheduleWaitingPromptTimer();
              if (settings.followup_enabled) scheduleFollowupTimer();
            }
          }
        } catch (e) {}
      }
    };
    xhr.send();
  }

  function sendMessage(body) {
    if (!conversationId || !body || !body.trim()) return;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/api/conversations/' + encodeURIComponent(conversationId) + '/messages', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var d = JSON.parse(xhr.responseText);
          if (d.message) {
            appendMessage(d.message);
            if (d.message.sender_type === 'visitor' && !contactSubmitted && !hasAgentReplied) {
              showWaitingStatus();
              scheduleWaitingPromptTimer();
              if (settings.followup_enabled) scheduleFollowupTimer();
            }
          }
        } catch (e) {}
      }
    };
    xhr.send(JSON.stringify({ body: body.trim() }));
  }

  function scheduleFollowupTimer() {
    if (followupTimer) clearTimeout(followupTimer);
    followupTimer = null;
    if (!settings.followup_enabled || contactSubmitted || hasAgentReplied) return;
    var delayMs = (settings.followup_delay_minutes || 2) * 60 * 1000;
    followupTimer = setTimeout(function () {
      followupTimer = null;
      if (contactSubmitted || hasAgentReplied) return;
      var box = root.querySelector('.er-chat-followup');
      if (box) box.classList.add('er-chat-followup-visible');
    }, delayMs);
  }

  function cancelFollowupTimer() {
    if (followupTimer) {
      clearTimeout(followupTimer);
      followupTimer = null;
    }
    var box = root.querySelector('.er-chat-followup');
    if (box) box.classList.remove('er-chat-followup-visible');
  }

  function showWaitingStatus() {
    if (hasAgentReplied || contactSubmitted) return;
    var list = root.querySelector('.er-chat-messages');
    if (!list || list.querySelector('.er-chat-waiting-status')) return;
    var hasVisitor = list.querySelector('.er-chat-msg.visitor');
    if (!hasVisitor) return;
    var status = document.createElement('div');
    status.className = 'er-chat-waiting-status';
    status.textContent = settings.waiting_status_text || 'Waiting on team member';
    list.appendChild(status);
    list.scrollTop = list.scrollHeight;
  }

  function cancelWaitingPromptTimer() {
    if (waitingPromptTimer) {
      clearTimeout(waitingPromptTimer);
      waitingPromptTimer = null;
    }
    var status = root.querySelector('.er-chat-waiting-status');
    if (status) status.remove();
    var prompt = root.querySelector('.er-chat-waiting-prompt');
    if (prompt) prompt.remove();
  }

  function scheduleWaitingPromptTimer() {
    if (waitingPromptTimer) clearTimeout(waitingPromptTimer);
    waitingPromptTimer = null;
    if (hasAgentReplied || contactSubmitted || waitingPromptShown) return;
    var delaySec = (settings.waiting_prompt_delay_seconds || 120) * 1000;
    if (delaySec <= 0) return;
    waitingPromptTimer = setTimeout(function () {
      waitingPromptTimer = null;
      if (hasAgentReplied || contactSubmitted || waitingPromptShown) return;
      waitingPromptShown = true;
      var list = root.querySelector('.er-chat-messages');
      if (!list) return;
      var prompt = document.createElement('div');
      prompt.className = 'er-chat-waiting-prompt';
      var question = (settings.waiting_prompt_question || '').replace(/</g, '&lt;');
      var keepLabel = (settings.waiting_prompt_keep_label || 'Keep waiting').replace(/</g, '&lt;');
      var contactLabel = (settings.waiting_prompt_contact_label || 'Have someone contact me').replace(/</g, '&lt;');
      prompt.innerHTML = '<div class="er-chat-waiting-prompt-text">' + question + '</div>' +
        '<div class="er-chat-waiting-prompt-buttons">' +
        '<button type="button" class="er-chat-waiting-btn er-chat-waiting-keep">' + keepLabel + '</button>' +
        '<button type="button" class="er-chat-waiting-btn er-chat-waiting-contact">' + contactLabel + '</button>' +
        '</div>';
      var keepBtn = prompt.querySelector('.er-chat-waiting-keep');
      var contactBtn = prompt.querySelector('.er-chat-waiting-contact');
      keepBtn.onclick = function () {
        prompt.remove();
      };
      contactBtn.onclick = function () {
        prompt.remove();
        var box = root.querySelector('.er-chat-followup');
        if (box) box.classList.add('er-chat-followup-visible');
      };
      contactBtn.style.backgroundColor = settings.primary_color || '#2563eb';
      list.appendChild(prompt);
      list.scrollTop = list.scrollHeight;
    }, delaySec);
  }

  function renderLauncher() {
    var el = document.createElement('button');
    el.className = 'er-chat-launcher ' + settings.position + (settings.button_style === 'icon_and_text' ? ' er-chat-launcher-with-text' : '');
    el.style.backgroundColor = settings.primary_color;
    el.setAttribute('aria-label', settings.button_label || 'Open chat');
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
      (settings.button_style === 'icon_and_text' ? '<span class="er-chat-launcher-label">' + (settings.button_label || 'Chat') + '</span>' : '');
    el.onclick = function () {
      el.style.display = 'none';
      showWindow();
    };
    root.appendChild(el);
    updateLauncherBadge();
  }

  function showWindow() {
    if (root.querySelector('.er-chat-window')) return;
    windowIsOpen = true;
    unreadCount = 0;
    updateLauncherBadge();
    if (autoOpenTimer) {
      clearTimeout(autoOpenTimer);
      autoOpenTimer = null;
    }
    ensureConversation(function () {
      connectWs();
      loadMessages();
      var wrap = document.createElement('div');
      wrap.className = 'er-chat-window ' + settings.position;
      var ooo = isOutOfOffice();
      var welcomeText = ooo ? (settings.ooo_message || '').replace(/</g, '&lt;') : (settings.welcome_text || '').replace(/</g, '&lt;');
      var followupTitle = (settings.followup_title || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var followupMessage = (settings.followup_message || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var followupSubmitLabel = (settings.followup_submit_label || 'Send').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var fields = settings.contact_form_fields || [];
      var followupFieldsHtml = '';
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var tid = (f.type || 'text');
        var ph = (f.placeholder || f.label || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        var lid = (f.label || f.id || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        followupFieldsHtml += '<label class="er-chat-followup-label">' + lid + '</label><input type="' + tid + '" class="er-chat-followup-field" data-field-id="' + (f.id || '').replace(/"/g, '&quot;') + '" placeholder="' + ph + '" ' + (f.required ? 'data-required="1"' : '') + ' />';
      }
      wrap.innerHTML =
        '<div class="er-chat-header" style="background:' + settings.primary_color + '">' +
        '<h3>' + (settings.header_title || 'Chat with us').replace(/</g, '&lt;') + '</h3>' +
        '</div>' +
        '<div class="er-chat-messages">' +
        '<div class="er-chat-welcome">' + welcomeText + '</div>' +
        '</div>' +
        '<div class="er-chat-followup" aria-hidden="true">' +
        '<div class="er-chat-followup-title">' + followupTitle + '</div>' +
        '<div class="er-chat-followup-message">' + followupMessage + '</div>' +
        '<div class="er-chat-followup-fields">' + followupFieldsHtml + '</div>' +
        '<div class="er-chat-followup-error"></div>' +
        '<button type="button" class="er-chat-followup-submit" style="background:' + settings.primary_color + '">' + followupSubmitLabel + '</button>' +
        '<div class="er-chat-followup-thanks" style="display:none">Thanks! We\'ll be in touch.</div>' +
        '</div>' +
        '<div class="er-chat-input-area">' +
        '<div class="er-chat-input-row">' +
        '<textarea class="er-chat-input" rows="1" placeholder="' + (settings.input_placeholder || 'Type a message...').replace(/"/g, '&quot;') + '"></textarea>' +
        '<button class="er-chat-send" style="background:' + settings.primary_color + '" type="button" aria-label="Send">' +
        '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
        '</button>' +
        '</div>' +
        '</div>';
      var header = wrap.querySelector('.er-chat-header');
      var messages = wrap.querySelector('.er-chat-messages');
      var welcome = wrap.querySelector('.er-chat-welcome');
      var input = wrap.querySelector('.er-chat-input');
      var sendBtn = wrap.querySelector('.er-chat-send');

      var onNewMessage = function () {
        if (welcome) welcome.style.display = 'none';
      };
      var origAppend = appendMessage;
      appendMessage = function (msg) {
        onNewMessage();
        if (msg.sender_type === 'agent') {
          hasAgentReplied = true;
          cancelFollowupTimer();
          cancelWaitingPromptTimer();
        }
        origAppend(msg);
      };
      if (messages && messages.children.length > 0) onNewMessage();

      sendBtn.onclick = function () {
        var text = input.value.trim();
        if (!text) return;
        sendMessage(text);
        input.value = '';
        sendComposing('');
      };
      input.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      };
      input.oninput = function () {
        if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
        typingDebounceTimer = setTimeout(function () {
          typingDebounceTimer = null;
          sendTyping();
        }, 300);
        scheduleComposingSend();
      };

      root.appendChild(wrap);

      if (ooo && settings.followup_enabled) {
        var delaySec = settings.ooo_contact_form_delay_seconds || 0;
        if (delaySec <= 0) {
          var box = wrap.querySelector('.er-chat-followup');
          if (box) box.classList.add('er-chat-followup-visible');
        } else {
          if (oooFormTimer) clearTimeout(oooFormTimer);
          oooFormTimer = setTimeout(function () {
            oooFormTimer = null;
            var box = root.querySelector('.er-chat-followup');
            if (box) box.classList.add('er-chat-followup-visible');
          }, delaySec * 1000);
        }
      }

      var followupBox = wrap.querySelector('.er-chat-followup');
      if (followupBox && settings.followup_enabled) {
        var followupError = followupBox.querySelector('.er-chat-followup-error');
        var followupThanks = followupBox.querySelector('.er-chat-followup-thanks');
        var followupSubmitBtn = followupBox.querySelector('.er-chat-followup-submit');
        var followupFieldsEl = followupBox.querySelector('.er-chat-followup-fields');
        followupSubmitBtn.addEventListener('click', function () {
          var inputs = followupBox.querySelectorAll('.er-chat-followup-field');
          var payload = {};
          var hasContact = false;
          for (var i = 0; i < inputs.length; i++) {
            var inp = inputs[i];
            var id = inp.getAttribute('data-field-id');
            if (id) payload[id] = (inp.value || '').trim();
            if ((id === 'email' || id === 'phone') && payload[id]) hasContact = true;
          }
          var anyVal = false;
          for (var k in payload) { if (payload[k]) anyVal = true; }
          if (!anyVal) {
            if (followupError) followupError.textContent = 'Please enter your contact details.';
            return;
          }
          var requiredInputs = followupBox.querySelectorAll('.er-chat-followup-field[data-required="1"]');
          for (var j = 0; j < requiredInputs.length; j++) {
            var r = requiredInputs[j];
            var rid = r.getAttribute('data-field-id');
            if (rid && !(payload[rid] || '').trim()) {
              if (followupError) followupError.textContent = 'Please fill in all required fields.';
              return;
            }
          }
          if (followupError) followupError.textContent = '';
          followupSubmitBtn.disabled = true;
          var xhr = new XMLHttpRequest();
          xhr.open('POST', BASE + '/api/conversations/' + encodeURIComponent(conversationId) + '/contact', true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.withCredentials = true;
          xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            contactSubmitted = true;
            if (xhr.status === 200) {
              followupBox.querySelector('.er-chat-followup-title').style.display = 'none';
              followupBox.querySelector('.er-chat-followup-message').style.display = 'none';
              if (followupFieldsEl) followupFieldsEl.style.display = 'none';
              followupSubmitBtn.style.display = 'none';
              if (followupThanks) followupThanks.style.display = 'block';
            } else {
              if (followupError) followupError.textContent = 'Something went wrong. Please try again.';
              followupSubmitBtn.disabled = false;
            }
          };
          xhr.send(JSON.stringify(payload));
        });
      }

      var launcher = root.querySelector('.er-chat-launcher');
      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:transparent;border:none;color:white;cursor:pointer;font-size:20px;line-height:1;padding:4px;';
      closeBtn.textContent = '\u00D7';
      closeBtn.setAttribute('aria-label', 'Close chat');
      closeBtn.onclick = function () {
        if (oooFormTimer) { clearTimeout(oooFormTimer); oooFormTimer = null; }
        markClosedForSession();
        wrap.remove();
        if (launcher) launcher.style.display = 'flex';
        windowIsOpen = false;
      };
      header.appendChild(closeBtn);

      setTimeout(function () { input.focus(); }, 100);
    });
  }

  function bootstrap() {
    loadSettings(function () {
      if (settings.button_always_visible) {
        renderLauncher();
        if (isMobileDevice() || isClosedForSession()) return;
        var popupDelay = (settings.chatbox_popup_delay_seconds || 0) * 1000;
        if (popupDelay > 0) {
          autoOpenTimer = setTimeout(function () {
            if (!windowIsOpen) showWindow();
          }, popupDelay);
        }
      } else {
        var delayMs = (settings.delay_seconds || 0) * 1000;
        setTimeout(function () {
          renderLauncher();
        }, delayMs);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
