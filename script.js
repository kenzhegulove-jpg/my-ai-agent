(() => {
  'use strict';

  // ---------- Константы и ключи хранения ----------
  const STORAGE_KEYS = {
    apiKey: 'ai_assistant_api_key',
    mode: 'ai_assistant_mode',
    chatHistory: 'chat_history',
  };

  // Настройки внешнего API (формат, совместимый с OpenAI Chat Completions).
  // Чтобы переключиться между провайдерами — поменяйте эти две константы.
  // OpenRouter: 'https://openrouter.ai/api/v1/chat/completions' + 'meta-llama/llama-3-8b-instruct:free'
  // Groq:       'https://api.groq.com/openai/v1/chat/completions' + 'llama3-8b-8192'
  const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const API_MODEL = 'openai/gpt-oss-20b';

  // Сколько последних сообщений истории отправлять модели для контекста
  const HISTORY_LIMIT = 10;

  // ---------- DOM-элементы ----------
  const modeSelect = document.getElementById('mode-select');
  const apiKeyWrapper = document.getElementById('api-key-wrapper');
  const apiKeyInput = document.getElementById('api-key-input');
  const chatMessages = document.getElementById('chat-messages');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const clearChatButton = document.getElementById('clear-chat-button');

  // Локальная история переписки в формате { role: 'user' | 'assistant', content: string }
  const conversationHistory = [];

  // База знаний, загружаемая из knowledge.json (null, пока не загружена или недоступна)
  let aiKnowledge = null;

  // ---------- Инициализация ----------
  function init() {
    restoreSettings();
    restoreChatHistory();
    bindEvents();
    autoResizeTextarea();
    loadKnowledgeBase();
  }

  // Загружает локальную базу знаний из knowledge.json.
  // Если файла нет, он пустой или сломан — просто оставляем aiKnowledge = null и не падаем.
  async function loadKnowledgeBase() {
    try {
      const response = await fetch('knowledge.json');

      if (!response.ok) {
        console.warn(`knowledge.json не найден или недоступен (статус ${response.status}). Работаем без базы знаний.`);
        return;
      }

      const data = await response.json();

      // Считаем базу знаний пустой, если это пустой объект/массив
      const isEmpty =
        data == null ||
        (Array.isArray(data) && data.length === 0) ||
        (typeof data === 'object' && Object.keys(data).length === 0);

      aiKnowledge = isEmpty ? null : data;

    } catch (error) {
      console.warn('Не удалось загрузить knowledge.json. Работаем без базы знаний.', error);
      aiKnowledge = null;
    }
  }

  // Восстанавливает историю переписки из localStorage и отображает ее в чате
  function restoreChatHistory() {
    const savedHistory = localStorage.getItem(STORAGE_KEYS.chatHistory);
    if (!savedHistory) return;

    let parsedHistory;
    try {
      parsedHistory = JSON.parse(savedHistory);
    } catch (error) {
      console.warn('Не удалось распарсить сохраненную историю чата:', error);
      localStorage.removeItem(STORAGE_KEYS.chatHistory);
      return;
    }

    if (!Array.isArray(parsedHistory) || parsedHistory.length === 0) return;

    // Заполняем локальный массив истории и отрисовываем каждое сообщение
    parsedHistory.forEach((item) => {
      if (!item || !item.role || !item.content) return;
      conversationHistory.push(item);
      const sender = item.role === 'user' ? 'user' : 'bot';
      addMessage(item.content, sender, { smooth: false });
    });
  }

  // Восстанавливаем сохраненные настройки (режим и API-ключ) из localStorage
  function restoreSettings() {
    const savedMode = localStorage.getItem(STORAGE_KEYS.mode);
    if (savedMode) {
      modeSelect.value = savedMode;
    }

    const savedApiKey = localStorage.getItem(STORAGE_KEYS.apiKey);
    if (savedApiKey) {
      apiKeyInput.value = savedApiKey;
    }

    toggleApiKeyField();
  }

  // ---------- Обработчики событий ----------
  function bindEvents() {
    modeSelect.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEYS.mode, modeSelect.value);
      toggleApiKeyField();
    });

    apiKeyInput.addEventListener('input', () => {
      localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value);
    });

    sendButton.addEventListener('click', handleSend);

    messageInput.addEventListener('keydown', (event) => {
      // Enter отправляет сообщение, Shift+Enter — перенос строки
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    });

    messageInput.addEventListener('input', autoResizeTextarea);

    clearChatButton.addEventListener('click', handleClearChat);
  }

  // Показываем поле API-ключа только для режима "Внешний API"
  function toggleApiKeyField() {
    if (modeSelect.value === 'api') {
      apiKeyWrapper.classList.remove('hidden');
    } else {
      apiKeyWrapper.classList.add('hidden');
    }
  }

  // Автоматическое расширение текстового поля по мере ввода
  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  }

  // ---------- Логика отправки сообщений ----------
  function handleSend() {
    const text = messageInput.value.trim();
    if (!text) return;

    conversationHistory.push({ role: 'user', content: text });
    saveChatHistory();
    addMessage(text, 'user');

    messageInput.value = '';
    autoResizeTextarea();

    fetchAIResponse();
  }

  // Сохраняет текущий массив истории переписки в localStorage
  function saveChatHistory() {
    localStorage.setItem(STORAGE_KEYS.chatHistory, JSON.stringify(conversationHistory));
  }

  // Полностью очищает чат: массив истории, localStorage и содержимое окна чата
  function handleClearChat() {
    const confirmed = window.confirm('Удалить всю историю переписки? Это действие необратимо.');
    if (!confirmed) return;

    conversationHistory.length = 0;
    localStorage.removeItem(STORAGE_KEYS.chatHistory);
    chatMessages.innerHTML = '';
  }

  // Собирает системный промпт: базовая инструкция + база знаний (если она загружена)
  function buildSystemPrompt() {
    const basePrompt = 'Ты полезный ИИ-ассистент.';

    if (!aiKnowledge) {
      return `${basePrompt} Отвечай на основе своих общих знаний.`;
    }

    const knowledgeText = JSON.stringify(aiKnowledge, null, 2);

    return `${basePrompt} Вот твоя база знаний, используй её для ответов, если там есть нужная информация: ${knowledgeText}. Если в базе знаний нет ответа, отвечай на основе своих общих знаний.`;
  }

  // Делает запрос к внешнему API и выводит ответ ассистента в чат
  async function fetchAIResponse() {
    const apiKey = localStorage.getItem(STORAGE_KEYS.apiKey);

    if (!apiKey) {
      addErrorMessage('Пожалуйста, введите ваш API-ключ в настройках сверху!');
      return;
    }

    const typingBubble = showTypingIndicator();

    // Берем последние HISTORY_LIMIT сообщений истории, чтобы модель помнила контекст
    const recentHistory = conversationHistory.slice(-HISTORY_LIMIT);

    // Формируем системный промпт с базой знаний (если она загрузилась) и ставим его первым сообщением
    const systemPrompt = buildSystemPrompt();
    const messagesToSend = [{ role: 'system', content: systemPrompt }, ...recentHistory];

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: API_MODEL,
          messages: messagesToSend,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Сервер вернул ошибку ${response.status}. ${errorText}`);
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();

      removeTypingIndicator(typingBubble);

      if (!reply) {
        addErrorMessage('Ответ от ИИ пришел пустым. Попробуйте еще раз.');
        return;
      }

      addMessage(reply, 'bot');
      conversationHistory.push({ role: 'assistant', content: reply });
      saveChatHistory();

    } catch (error) {
      removeTypingIndicator(typingBubble);
      addErrorMessage(`Не удалось получить ответ: ${error.message}`);
    }
  }

  // Создает элемент аватарки для сообщения ('user' или 'bot')
  function createAvatar(sender) {
    const avatar = document.createElement('div');
    avatar.className = 'message__avatar';
    avatar.textContent = sender === 'user' ? '👤' : '🤖';
    return avatar;
  }

  // Добавляет сообщение в окно чата
  function addMessage(text, sender, { smooth = true } = {}) {
    const messageEl = document.createElement('div');
    messageEl.className = `message message--${sender}`;

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble';
    bubble.textContent = sender === 'user' ? `Вы: ${text}` : text;

    messageEl.appendChild(createAvatar(sender));
    messageEl.appendChild(bubble);
    chatMessages.appendChild(messageEl);

    scrollToBottom(smooth);
    return messageEl;
  }

  // Добавляет системное сообщение об ошибке (визуально выделено)
  function addErrorMessage(text) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message message--bot';

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble message__bubble--error';
    bubble.textContent = `⚠️ ${text}`;

    messageEl.appendChild(createAvatar('bot'));
    messageEl.appendChild(bubble);
    chatMessages.appendChild(messageEl);

    scrollToBottom();
    return messageEl;
  }

  // Показывает индикатор "печатает..." — три пульсирующие точки
  function showTypingIndicator() {
    const messageEl = document.createElement('div');
    messageEl.className = 'message message--bot message--typing';

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble message__bubble--typing';
    bubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';

    messageEl.appendChild(createAvatar('bot'));
    messageEl.appendChild(bubble);
    chatMessages.appendChild(messageEl);

    scrollToBottom();
    return messageEl;
  }

  function removeTypingIndicator(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  // Прокручивает окно чата вниз к последнему сообщению (плавно или мгновенно)
  function scrollToBottom(smooth = true) {
    const chatWindow = chatMessages.parentElement;
    chatWindow.scrollTo({
      top: chatWindow.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  // ---------- Запуск ----------
  document.addEventListener('DOMContentLoaded', init);
})();