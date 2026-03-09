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
    agent_display_names: {},
    followup_enabled: true,
    followup_delay_minutes: 2,
    followup_title: "We'll get back to you",
    followup_message: 'Leave your name and email or phone so we can reach you.',
    followup_name_placeholder: 'Name',
    followup_email_placeholder: 'Email',
    followup_phone_placeholder: 'Phone',
    followup_submit_label: 'Send'
  };
  var lastShownAgentKey = null;
  var autoOpenTimer = null;
  var windowIsOpen = false;
  var followupTimer = null;
  var contactSubmitted = false;

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
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
          settings.agent_display_names = s.agent_display_names || {};
          settings.followup_enabled = s.followup_enabled !== false;
          settings.followup_delay_minutes = Math.max(1, parseInt(s.followup_delay_minutes, 10) || 2);
          settings.followup_title = s.followup_title || settings.followup_title;
          settings.followup_message = s.followup_message || settings.followup_message;
          settings.followup_name_placeholder = s.followup_name_placeholder || 'Name';
          settings.followup_email_placeholder = s.followup_email_placeholder || 'Email';
          settings.followup_phone_placeholder = s.followup_phone_placeholder || 'Phone';
          settings.followup_submit_label = s.followup_submit_label || 'Send';
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

  function connectWs() {
    if (!conversationId) return;
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = (BASE.match(/^https?:\/\/([^/]+)/) || [])[1] || window.location.host;
    var url = proto + '//' + host + '/ws?conversation_id=' + encodeURIComponent(conversationId);
    try {
      ws = new WebSocket(url);
      ws.onmessage = function (ev) {
        try {
          var p = JSON.parse(ev.data);
          if (p.type === 'new_message' && p.message && p.message.sender_type === 'agent') appendMessage(p.message);
        } catch (e) {}
      };
    } catch (e) {}
  }

  function getAgentDisplayName(email) {
    if (!email || !settings.agent_display_names) return null;
    var key = (email || '').toLowerCase();
    return settings.agent_display_names[key] || settings.agent_display_names[email] || null;
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
        joined.textContent = 'Now chatting with ' + label;
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
            list.innerHTML = '<div class="er-chat-welcome">' + (settings.welcome_text || '') + '</div>';
            lastShownAgentKey = null;
            (d.messages || []).forEach(appendMessage);
            var agentMsgs = (d.messages || []).filter(function(m) { return m.sender_type === 'agent' && m.agent_email; });
            if (agentMsgs.length > 0) {
              var last = (agentMsgs[agentMsgs.length - 1].agent_email || '').toLowerCase();
              lastShownAgentKey = last || null;
            }
            if ((d.messages || []).length > 0) {
              var w = list.querySelector('.er-chat-welcome');
              if (w) w.style.display = 'none';
            }
            var lastMsg = (d.messages || [])[(d.messages || []).length - 1];
            if (lastMsg && lastMsg.sender_type === 'visitor' && settings.followup_enabled && !contactSubmitted) scheduleFollowupTimer();
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
          if (d.message) appendMessage(d.message);
          if (settings.followup_enabled && !contactSubmitted) scheduleFollowupTimer();
        } catch (e) {}
      }
    };
    xhr.send(JSON.stringify({ body: body.trim() }));
  }

  function scheduleFollowupTimer() {
    if (followupTimer) clearTimeout(followupTimer);
    followupTimer = null;
    if (!settings.followup_enabled || contactSubmitted) return;
    var delayMs = (settings.followup_delay_minutes || 2) * 60 * 1000;
    followupTimer = setTimeout(function () {
      followupTimer = null;
      if (contactSubmitted) return;
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
  }

  function showWindow() {
    if (root.querySelector('.er-chat-window')) return;
    windowIsOpen = true;
    if (autoOpenTimer) {
      clearTimeout(autoOpenTimer);
      autoOpenTimer = null;
    }
    ensureConversation(function () {
      connectWs();
      loadMessages();
      var wrap = document.createElement('div');
      wrap.className = 'er-chat-window ' + settings.position;
      var followupTitle = (settings.followup_title || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var followupMessage = (settings.followup_message || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      var followupNamePh = (settings.followup_name_placeholder || 'Name').replace(/"/g, '&quot;');
      var followupEmailPh = (settings.followup_email_placeholder || 'Email').replace(/"/g, '&quot;');
      var followupPhonePh = (settings.followup_phone_placeholder || 'Phone').replace(/"/g, '&quot;');
      var followupSubmitLabel = (settings.followup_submit_label || 'Send').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      wrap.innerHTML =
        '<div class="er-chat-header" style="background:' + settings.primary_color + '">' +
        '<h3>' + (settings.header_title || 'Chat with us').replace(/</g, '&lt;') + '</h3>' +
        '</div>' +
        '<div class="er-chat-messages">' +
        '<div class="er-chat-welcome">' + (settings.welcome_text || '').replace(/</g, '&lt;') + '</div>' +
        '</div>' +
        '<div class="er-chat-followup" aria-hidden="true">' +
        '<div class="er-chat-followup-title">' + followupTitle + '</div>' +
        '<div class="er-chat-followup-message">' + followupMessage + '</div>' +
        '<input type="text" class="er-chat-followup-name" placeholder="' + followupNamePh + '" />' +
        '<input type="email" class="er-chat-followup-email" placeholder="' + followupEmailPh + '" />' +
        '<input type="tel" class="er-chat-followup-phone" placeholder="' + followupPhonePh + '" />' +
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
        if (msg.sender_type === 'agent') cancelFollowupTimer();
        origAppend(msg);
      };
      if (messages && messages.children.length > 0) onNewMessage();

      sendBtn.onclick = function () {
        var text = input.value.trim();
        if (!text) return;
        sendMessage(text);
        input.value = '';
      };
      input.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      };

      root.appendChild(wrap);

      var followupBox = wrap.querySelector('.er-chat-followup');
      if (followupBox && settings.followup_enabled) {
        var followupEmail = followupBox.querySelector('.er-chat-followup-email');
        var followupPhone = followupBox.querySelector('.er-chat-followup-phone');
        var followupName = followupBox.querySelector('.er-chat-followup-name');
        var followupError = followupBox.querySelector('.er-chat-followup-error');
        var followupThanks = followupBox.querySelector('.er-chat-followup-thanks');
        var followupSubmitBtn = followupBox.querySelector('.er-chat-followup-submit');
        followupSubmitBtn.addEventListener('click', function () {
          var email = (followupEmail && followupEmail.value || '').trim();
          var phone = (followupPhone && followupPhone.value || '').trim();
          if (!email && !phone) {
            if (followupError) followupError.textContent = 'Please enter your email or phone.';
            return;
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
              followupEmail.style.display = 'none';
              followupPhone.style.display = 'none';
              followupName.style.display = 'none';
              followupSubmitBtn.style.display = 'none';
              if (followupThanks) followupThanks.style.display = 'block';
            } else {
              if (followupError) followupError.textContent = 'Something went wrong. Please try again.';
              followupSubmitBtn.disabled = false;
            }
          };
          xhr.send(JSON.stringify({
            name: followupName ? followupName.value.trim() : '',
            email: email,
            phone: phone
          }));
        });
      }

      var launcher = root.querySelector('.er-chat-launcher');
      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:transparent;border:none;color:white;cursor:pointer;font-size:20px;line-height:1;padding:4px;';
      closeBtn.textContent = '\u00D7';
      closeBtn.setAttribute('aria-label', 'Close chat');
      closeBtn.onclick = function () {
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
