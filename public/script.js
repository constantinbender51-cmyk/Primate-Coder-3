class CodeEditor {
    constructor() {
        this.currentFile = null;
        this.pendingEdits = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setMobileView();
        
        // Check repo status before loading files
        await this.checkRepoStatus();
        await this.loadFileTree();
    }

    setupEventListeners() {
        // Mobile tabs
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Message sending
        document.getElementById('send-message').addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // File operations
        document.getElementById('refresh-files').addEventListener('click', () => this.loadFileTree());
        document.getElementById('apply-edit').addEventListener('click', () => this.applyEdits());
        document.getElementById('cancel-edit').addEventListener('click', () => this.hideEditPreview());
        document.getElementById('close-preview').addEventListener('click', () => this.hideEditPreview());

        // Window resize
        window.addEventListener('resize', () => this.setMobileView());
    }

    setMobileView() {
        const isMobile = window.innerWidth < 768;
        document.body.classList.toggle('mobile', isMobile);
    }

    switchTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Show/hide panes
        document.getElementById('code-pane').classList.toggle('active', tab === 'code');
        document.getElementById('chat-pane').classList.toggle('active', tab === 'chat');
    }

    async loadFileTree() {
        try {
            const response = await fetch('/api/files/tree');
            const files = await response.json();
            this.renderFileTree(files);
        } catch (error) {
            console.error('Failed to load file tree:', error);
            this.showError('Failed to load repository files');
        }
    }

    renderFileTree(files, container = null, level = 0) {
        const treeContainer = container || document.getElementById('file-tree');
        
        if (!container) {
            treeContainer.innerHTML = '';
        }

        files.forEach(item => {
            const fileElement = document.createElement('div');
            fileElement.className = `file-item ${item.type} ${level > 0 ? 'child' : ''}`;
            fileElement.style.paddingLeft = `${8 + (level * 16)}px`;
            fileElement.innerHTML = `
                <span class="file-name">${item.name}</span>
            `;

            fileElement.addEventListener('click', () => {
                if (item.type === 'file') {
                    this.loadFileContent(item.path);
                } else {
                    // Toggle directory
                    const wasExpanded = fileElement.classList.contains('expanded');
                    fileElement.classList.toggle('expanded', !wasExpanded);
                    
                    const childrenContainer = fileElement.querySelector('.file-children');
                    if (childrenContainer) {
                        childrenContainer.style.display = wasExpanded ? 'none' : 'block';
                    }
                }
            });

            treeContainer.appendChild(fileElement);

            if (item.type === 'dir' && item.children) {
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'file-children';
                childrenContainer.style.display = 'none';
                treeContainer.appendChild(childrenContainer);
                this.renderFileTree(item.children, childrenContainer, level + 1);
            }
        });
    }

    async loadFileContent(filePath) {
        try {
            this.currentFile = filePath;
            
            // Update active file in tree
            document.querySelectorAll('.file-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Show loading
            document.getElementById('file-content').innerHTML = `
                <div class="loading">Loading ${filePath}...</div>
            `;

            const response = await fetch(`/api/files/content/${encodeURIComponent(filePath)}`);
            const fileData = await response.json();
            
            this.renderFileContent(fileData.content, filePath);
        } catch (error) {
            console.error('Failed to load file content:', error);
            document.getElementById('file-content').innerHTML = `
                <div class="error">Failed to load file: ${error.message}</div>
            `;
        }
    }

    renderFileContent(content, filePath) {
        const lines = content.split('\n');
        const lineNumbers = lines.map((_, index) => index + 1);
        
        const html = `
            <div class="code-content">
                ${lines.map((line, index) => `
                    <div class="code-line">
                        <span class="line-number">${index + 1}</span>
                        <span class="line-content">${this.escapeHtml(line)}</span>
                    </div>
                `).join('')}
            </div>
        `;
        
        document.getElementById('file-content').innerHTML = html;
        
        // Update active file in tree
        document.querySelectorAll('.file-item').forEach(item => {
            if (item.querySelector('.file-name')?.textContent === filePath.split('/').pop()) {
                item.classList.add('active');
            }
        });
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (!message) return;

        // Add user message to chat
        this.addMessage('user', message);
        input.value = '';
        this.setSendButtonState(false);

        // Show loading indicator
        this.addMessage('ai', '🔍 Analyzing repository and generating changes...');

        try {
            const response = await fetch('/api/deepseek/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.details || data.error);
            }

            // Remove the loading message and add the actual response
            const messagesContainer = document.getElementById('chat-messages');
            const lastMessage = messagesContainer.lastElementChild;
            if (lastMessage && lastMessage.querySelector('.message-content')?.textContent.includes('Analyzing repository')) {
                lastMessage.remove();
            }

            this.addMessage('ai', data.message);

            // Show edit preview if there are edits
            if (data.edits && data.edits.length > 0) {
                this.showEditPreview(data.edits);
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            
            // Remove loading message if it exists
            const messagesContainer = document.getElementById('chat-messages');
            const lastMessage = messagesContainer.lastElementChild;
            if (lastMessage && lastMessage.querySelector('.message-content')?.textContent.includes('Analyzing repository')) {
                lastMessage.remove();
            }
            
            this.addMessage('ai', `Error: ${error.message}`);
        } finally {
            this.setSendButtonState(true);
        }
    }

    addMessage(sender, content) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        messageElement.innerHTML = `
            <div class="message-sender">${sender === 'user' ? 'You' : 'AI'}</div>
            <div class="message-content">${this.formatMessage(content)}</div>
        `;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    formatMessage(content) {
        // Convert markdown code blocks to HTML
        return content
            .replace(/```json\n([\s\S]*?)\n```/g, '<pre><code class="json">$1</code></pre>')
            .replace(/```(\w+)\n([\s\S]*?)\n```/g, '<pre><code class="$1">$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    showEditPreview(edits) {
        this.pendingEdits = edits;
        
        const previewContent = edits.map(edit => `
            <div class="edit-item">
                <strong>${edit.file_name}</strong> - ${edit.action} at line ${edit.line}
                <pre>${edit.content || 'No content'}</pre>
            </div>
        `).join('');
        
        document.getElementById('edit-content').innerHTML = previewContent;
        document.getElementById('edit-preview').style.display = 'block';
        
        // Switch to chat tab on mobile to show preview
        if (window.innerWidth < 768) {
            this.switchTab('chat');
        }
    }

    hideEditPreview() {
        const preview = document.getElementById('edit-preview');
        if (preview) {
            preview.style.display = 'none';
        }
        this.pendingEdits = null;
    }

    async applyEdits() {
        if (!this.pendingEdits) return;

        const applyButton = document.getElementById('apply-edit');
        const originalText = applyButton.textContent;
        applyButton.textContent = 'Applying...';
        applyButton.disabled = true;

        try {
            const response = await fetch('/api/github/apply-edits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edits: this.pendingEdits })
            });

            const data = await response.json();
        
            if (data.error) {
                throw new Error(data.details || data.error);
            }

            this.addMessage('ai', '✅ Changes applied successfully!');
        
            // Store the edits before hiding the preview
            const appliedEdits = [...this.pendingEdits];
            this.hideEditPreview();
        
            // Reload affected files
            appliedEdits.forEach(edit => {
                if (edit.file_name === this.currentFile) {
                    this.loadFileContent(this.currentFile);
                }
            });
        
            // Refresh file tree to show new files
            await this.loadFileTree();
        
        } catch (error) {
            console.error('Failed to apply edits:', error);
            this.addMessage('ai', `❌ Failed to apply changes: ${error.message}`);
        } finally {
            applyButton.textContent = originalText;
            applyButton.disabled = false;
        }
}

    setSendButtonState(enabled) {
        const button = document.getElementById('send-message');
        button.disabled = !enabled;
        button.textContent = enabled ? 'Send' : 'Sending...';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        // Simple error display - you might want to use a toast or better UI
        alert(message);
    }

    async checkRepoStatus() {
        try {
            const response = await fetch('/api/files/repo-status');
            const status = await response.json();
            
            if (!status.exists) {
                this.showRepoError('Repository not found or inaccessible. Please check your configuration.');
                return false;
            }
            
            if (status.empty) {
                this.showEmptyRepoPrompt();
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Failed to check repo status:', error);
            this.showRepoError('Failed to connect to repository');
            return false;
        }
    }

    showEmptyRepoPrompt() {
        const messagesContainer = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.className = 'message ai-message';
        messageElement.innerHTML = `
            <div class="message-sender">AI</div>
            <div class="message-content">
                <p>📝 This repository is empty. I can help you get started!</p>
                <p>Would you like me to create an initial file to begin working?</p>
                <div class="repo-actions">
                    <button class="btn btn-primary" id="init-repo">Create README.md</button>
                    <button class="btn btn-secondary" id="skip-init">Skip for now</button>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Add event listeners for the buttons
        document.getElementById('init-repo').addEventListener('click', () => this.initializeRepo());
        document.getElementById('skip-init').addEventListener('click', () => {
            messageElement.remove();
            this.addMessage('ai', 'Okay! You can ask me to create files whenever you\'re ready.');
        });
    }

    async initializeRepo() {
        try {
            const response = await fetch('/api/files/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: 'README.md',
                    content: '# AI Code Editor Project\n\nThis repository was initialized by the AI Code Editor.\n\nStart by asking the AI to create or modify files!'
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.addMessage('ai', '✅ Repository initialized! Created README.md. You can now start editing files.');
                this.loadFileTree(); // Refresh the file tree
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Failed to initialize repo:', error);
            this.addMessage('ai', `❌ Failed to initialize repository: ${error.message}`);
        }
    }

    showRepoError(message) {
        const fileTree = document.getElementById('file-tree');
        fileTree.innerHTML = `
            <div class="repo-error">
                <div class="error-icon">⚠️</div>
                <div class="error-message">${message}</div>
                <div class="error-help">
                    Please check:
                    <ul>
                        <li>Repository exists and is accessible</li>
                        <li>GitHub token has correct permissions</li>
                        <li>Repository name and owner are correct</li>
                    </ul>
                </div>
            </div>
        `;
        
        // Also show error in chat
        this.addMessage('ai', `Repository Error: ${message}`);
    }

    async loadFileTree() {
        try {
            // First check repo status
            const repoOk = await this.checkRepoStatus();
            if (!repoOk) return;

            const response = await fetch('/api/files/tree');
            const files = await response.json();
            
            if (files.length === 0) {
                this.showEmptyRepoState();
            } else {
                this.renderFileTree(files);
            }
        } catch (error) {
            console.error('Failed to load file tree:', error);
            this.showError('Failed to load repository files');
        }
    }

    showEmptyRepoState() {
        const fileTree = document.getElementById('file-tree');
        fileTree.innerHTML = `
            <div class="empty-repo">
                <div class="empty-icon">📁</div>
                <div class="empty-message">Repository is empty</div>
                <button class="btn btn-primary" id="init-from-tree">Initialize Repository</button>
            </div>
        `;
        
        document.getElementById('init-from-tree').addEventListener('click', () => this.initializeRepo());
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CodeEditor();
});
