class GameClient {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.worldImage = null;
        this.worldWidth = 2048;
        this.worldHeight = 2048;
        
        // Game state
        this.myPlayerId = null;
        this.players = {};
        this.avatars = {};
        this.websocket = null;
        this.isConnected = false;
        this.avatarImageCache = {};
        
        // Movement state
        this.keyState = {
            up: false,
            down: false,
            left: false,
            right: false
        };
        this.isMoving = false;
        this.animationId = null;
        this.targetX = null;
        this.targetY = null;
        this.isClickMoving = false;
        
        // Animation state
        this.animationTime = 0;
        this.animationSpeed = 0.1; // Animation frame change speed
        
        // Particle effects
        this.particles = [];
        this.maxParticles = 50;
        
        // Viewport/camera
        this.viewportX = 0;
        this.viewportY = 0;
        this.viewportWidth = 0;
        this.viewportHeight = 0;
        
        this.init();
    }
    
    init() {
        this.setupCanvas();
        this.loadWorldMap();
        this.setupEventListeners();
        this.connectToServer();
        this.startMovementLoop();
    }
    
    setupCanvas() {
        // Set canvas size to fill the browser window
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.viewportWidth = this.canvas.width;
        this.viewportHeight = this.canvas.height;
        
        // Initialize viewport to upper-left
        this.resetViewport();
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.viewportWidth = this.canvas.width;
            this.viewportHeight = this.canvas.height;
            this.updateViewport();
            this.draw();
        });
    }
    
    loadWorldMap() {
        this.worldImage = new Image();
        this.worldImage.onload = () => {
            console.log('World map loaded successfully');
            // Always start at upper-left corner
            this.resetViewport();
            this.draw();
        };
        this.worldImage.onerror = () => {
            console.error('Failed to load world map');
        };
        this.worldImage.src = 'world.jpg';
    }
    
    draw() {
        if (!this.worldImage) return;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw world map with viewport offset
        this.ctx.drawImage(
            this.worldImage,
            this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight,  // Source rectangle (viewport)
            0, 0, this.viewportWidth, this.viewportHeight   // Destination rectangle (screen)
        );
        
        // Draw all players
        this.drawPlayers();
        
        // Draw particle effects
        this.drawParticles();
        
        // Draw UI elements
        this.drawUI();
    }
    
    drawPlayers() {
        // Draw all players
        Object.values(this.players).forEach(player => {
            this.drawPlayer(player);
        });
    }
    
    drawPlayer(player) {
        // Convert world coordinates to screen coordinates
        const screenX = player.x - this.viewportX;
        const screenY = player.y - this.viewportY;
        
        // Check if player is visible in viewport
        if (screenX < -50 || screenX > this.viewportWidth + 50 || 
            screenY < -50 || screenY > this.viewportHeight + 50) {
            return;
        }
        
        // Get avatar data
        const avatar = this.avatars[player.avatar];
        if (!avatar) return;
        
        // Get the correct frame based on facing direction and animation frame
        const direction = player.facing;
        let frameIndex = player.animationFrame || 0;
        
        // Smooth animation for my player
        if (player.id === this.myPlayerId && player.isMoving) {
            frameIndex = Math.floor(this.animationTime) % 3;
        }
        
        const frames = avatar.frames[direction];
        
        if (!frames || !frames[frameIndex]) return;
        
        // Create cache key for this specific frame
        const cacheKey = `${player.avatar}_${direction}_${frameIndex}`;
        
        // Get or load avatar image
        let avatarImg = this.avatarImageCache[cacheKey];
        if (!avatarImg) {
            avatarImg = new Image();
            avatarImg.onload = () => {
                // Redraw when image loads
                this.draw();
            };
            avatarImg.src = frames[frameIndex];
            this.avatarImageCache[cacheKey] = avatarImg;
            return; // Don't draw until image is loaded
        }
        
        // Draw avatar if image is loaded
        if (avatarImg.complete && avatarImg.naturalWidth > 0) {
            // Calculate avatar size (maintain aspect ratio)
            const avatarSize = 32; // Base size
            const aspectRatio = avatarImg.width / avatarImg.height;
            const width = avatarSize;
            const height = avatarSize / aspectRatio;
            
            // Draw avatar centered on player position
            this.ctx.drawImage(
                avatarImg,
                screenX - width / 2,
                screenY - height,
                width,
                height
            );
            
            // Add glow effect for my player
            if (player.id === this.myPlayerId) {
                this.ctx.shadowColor = 'cyan';
                this.ctx.shadowBlur = 10;
                this.ctx.drawImage(
                    avatarImg,
                    screenX - width / 2,
                    screenY - height,
                    width,
                    height
                );
                this.ctx.shadowBlur = 0;
            }
            
            // Draw username label (show ID if multiple players with same name)
            const displayName = this.getDisplayName(player);
            this.drawPlayerLabel(displayName, screenX, screenY - height - 5);
            
            // Add movement particles for moving players
            if (player.isMoving) {
                this.addMovementParticles(screenX, screenY);
            }
        }
    }
    
    drawPlayerLabel(username, x, y) {
        this.ctx.save();
        
        // Set font
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        
        // Measure text for background
        const textWidth = this.ctx.measureText(username).width;
        const padding = 4;
        
        // Draw background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(
            x - textWidth / 2 - padding,
            y - 12,
            textWidth + padding * 2,
            16
        );
        
        // Draw text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(username, x, y);
        
        this.ctx.restore();
    }
    
    getDisplayName(player) {
        // Check if there are multiple players with the same username
        const sameNamePlayers = Object.values(this.players).filter(p => p.username === player.username);
        
        if (sameNamePlayers.length > 1) {
            // Show username with last 4 characters of ID to distinguish
            return `${player.username} (${player.id.slice(-4)})`;
        }
        
        return player.username;
    }
    
    connectToServer() {
        try {
            this.websocket = new WebSocket('wss://codepath-mmorg.onrender.com');
            
            this.websocket.onopen = () => {
                console.log('Connected to game server');
                this.isConnected = true;
                this.joinGame();
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleServerMessage(message);
                } catch (error) {
                    console.error('Error parsing server message:', error);
                }
            };
            
            this.websocket.onclose = () => {
                console.log('Disconnected from game server');
                this.isConnected = false;
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to connect to server:', error);
        }
    }
    
    joinGame() {
        const message = {
            action: 'join_game',
            username: 'Tim'
        };
        
        this.websocket.send(JSON.stringify(message));
        console.log('Sent join_game message');
    }
    
    handleServerMessage(message) {
        console.log('Received message:', message);
        
        switch (message.action) {
            case 'join_game':
                if (message.success) {
                    this.myPlayerId = message.playerId;
                    this.players = message.players;
                    this.avatars = message.avatars;
                    console.log('Joined game successfully. Player ID:', this.myPlayerId);
                    this.updateViewport();
                    this.draw();
                } else {
                    console.error('Failed to join game:', message.error);
                }
                break;
                
            case 'player_joined':
                this.players[message.player.id] = message.player;
                this.avatars[message.avatar.name] = message.avatar;
                this.draw();
                break;
                
            case 'players_moved':
                Object.assign(this.players, message.players);
                // Update viewport to follow my player
                if (this.myPlayerId && this.players[this.myPlayerId]) {
                    this.updateViewport();
                }
                this.draw();
                break;
                
            case 'player_left':
                delete this.players[message.playerId];
                this.draw();
                break;
                
            default:
                console.log('Unknown message type:', message.action);
        }
    }
    
    updateViewport() {
        if (!this.myPlayerId || !this.players[this.myPlayerId]) {
            // If no player data yet, show upper-left of map
            this.viewportX = 0;
            this.viewportY = 0;
            return;
        }
        
        const myPlayer = this.players[this.myPlayerId];
        
        // Center viewport on my player
        this.viewportX = myPlayer.x - this.viewportWidth / 2;
        this.viewportY = myPlayer.y - this.viewportHeight / 2;
        
        // Clamp viewport to map boundaries
        this.viewportX = Math.max(0, Math.min(this.viewportX, this.worldWidth - this.viewportWidth));
        this.viewportY = Math.max(0, Math.min(this.viewportY, this.worldHeight - this.viewportHeight));
    }
    
    resetViewport() {
        // Always reset to upper-left corner
        this.viewportX = 0;
        this.viewportY = 0;
    }
    
    setupEventListeners() {
        // Add click event for click-to-move functionality
        this.canvas.addEventListener('click', (event) => {
            if (!this.isConnected || !this.myPlayerId) return;
            
            const rect = this.canvas.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            
            // Convert screen coordinates to world coordinates
            const worldX = screenX + this.viewportX;
            const worldY = screenY + this.viewportY;
            
            this.moveToPosition(worldX, worldY);
        });
        
        // Add keyboard event listeners for movement
        document.addEventListener('keydown', (event) => {
            this.handleKeyDown(event);
        });
        
        document.addEventListener('keyup', (event) => {
            this.handleKeyUp(event);
        });
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            this.stopMovementLoop();
        });
    }
    
    handleKeyDown(event) {
        if (!this.isConnected || !this.myPlayerId) return;
        
        let direction = null;
        let key = null;
        
        switch(event.key) {
            case 'ArrowUp':
            case 'w':
            case 'W':
                direction = 'up';
                key = 'up';
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                direction = 'down';
                key = 'down';
                break;
            case 'ArrowLeft':
            case 'a':
            case 'A':
                direction = 'left';
                key = 'left';
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                direction = 'right';
                key = 'right';
                break;
        }
        
        if (direction && key && !this.keyState[key]) {
            this.keyState[key] = true;
            this.sendMoveCommand(direction);
        }
    }
    
    handleKeyUp(event) {
        if (!this.isConnected || !this.myPlayerId) return;
        
        let key = null;
        
        switch(event.key) {
            case 'ArrowUp':
            case 'w':
            case 'W':
                key = 'up';
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                key = 'down';
                break;
            case 'ArrowLeft':
            case 'a':
            case 'A':
                key = 'left';
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                key = 'right';
                break;
        }
        
        if (key && this.keyState[key]) {
            this.keyState[key] = false;
            this.sendStopCommand();
        }
    }
    
    sendMoveCommand(direction) {
        if (!this.isConnected) return;
        
        const message = {
            action: 'move',
            direction: direction
        };
        
        this.websocket.send(JSON.stringify(message));
        console.log(`Sent move command: ${direction}`);
    }
    
    sendStopCommand() {
        if (!this.isConnected) return;
        
        // Only send stop if no keys are pressed
        const anyKeyPressed = Object.values(this.keyState).some(pressed => pressed);
        if (!anyKeyPressed) {
            const message = {
                action: 'stop'
            };
            
            this.websocket.send(JSON.stringify(message));
            console.log('Sent stop command');
        }
    }
    
    startMovementLoop() {
        const animate = () => {
            this.updateMovement();
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }
    
    stopMovementLoop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    updateMovement() {
        if (!this.isConnected || !this.myPlayerId) return;
        
        // Update animation time
        this.animationTime += this.animationSpeed;
        
        // Check if any movement keys are pressed
        const anyKeyPressed = Object.values(this.keyState).some(pressed => pressed);
        
        if (anyKeyPressed && !this.isMoving) {
            this.isMoving = true;
            this.isClickMoving = false; // Stop click movement when using keyboard
        } else if (!anyKeyPressed && this.isMoving) {
            this.isMoving = false;
        }
        
        // Update particles
        this.updateParticles();
    }
    
    moveToPosition(x, y) {
        if (!this.isConnected) return;
        
        // Clamp coordinates to map boundaries
        x = Math.max(0, Math.min(x, this.worldWidth));
        y = Math.max(0, Math.min(y, this.worldHeight));
        
        this.targetX = x;
        this.targetY = y;
        this.isClickMoving = true;
        
        const message = {
            action: 'move',
            x: x,
            y: y
        };
        
        this.websocket.send(JSON.stringify(message));
        console.log(`Moving to position: (${x}, ${y})`);
    }
    
    drawUI() {
        this.ctx.save();
        
        // Draw mini-map
        this.drawMiniMap();
        
        // Draw player count
        this.drawPlayerCount();
        
        // Draw movement indicator
        this.drawMovementIndicator();
        
        this.ctx.restore();
    }
    
    drawMiniMap() {
        const miniMapSize = 150;
        const miniMapX = this.viewportWidth - miniMapSize - 10;
        const miniMapY = 10;
        const scale = miniMapSize / this.worldWidth;
        
        // Draw mini-map background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(miniMapX - 5, miniMapY - 5, miniMapSize + 10, miniMapSize + 10);
        
        // Draw mini-map border
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(miniMapX, miniMapY, miniMapSize, miniMapSize);
        
        // Draw viewport rectangle on mini-map
        this.ctx.strokeStyle = 'yellow';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
            miniMapX + this.viewportX * scale,
            miniMapY + this.viewportY * scale,
            this.viewportWidth * scale,
            this.viewportHeight * scale
        );
        
        // Draw players on mini-map
        Object.values(this.players).forEach(player => {
            const playerX = miniMapX + player.x * scale;
            const playerY = miniMapY + player.y * scale;
            
            this.ctx.fillStyle = player.id === this.myPlayerId ? 'lime' : 'red';
            this.ctx.fillRect(playerX - 1, playerY - 1, 3, 3);
        });
    }
    
    drawPlayerCount() {
        const playerCount = Object.keys(this.players).length;
        const text = `Players: ${playerCount}`;
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(10, 10, 120, 30);
        
        this.ctx.fillStyle = 'white';
        this.ctx.font = '16px Arial';
        this.ctx.fillText(text, 20, 30);
    }
    
    drawMovementIndicator() {
        if (this.isClickMoving && this.targetX !== null && this.targetY !== null) {
            const screenX = this.targetX - this.viewportX;
            const screenY = this.targetY - this.viewportY;
            
            // Draw target indicator
            this.ctx.strokeStyle = 'yellow';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, 20, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Draw pulsing effect
            const pulse = Math.sin(this.animationTime * 2) * 0.5 + 0.5;
            this.ctx.strokeStyle = `rgba(255, 255, 0, ${pulse})`;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, 15 + pulse * 10, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }
    
    addMovementParticles(x, y) {
        if (this.particles.length < this.maxParticles) {
            this.particles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                life: 1.0,
                decay: 0.02,
                size: Math.random() * 3 + 1,
                color: `hsl(${Math.random() * 60 + 180}, 70%, 60%)`
            });
        }
    }
    
    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= particle.decay;
            
            if (particle.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }
    
    drawParticles() {
        this.particles.forEach(particle => {
            this.ctx.save();
            this.ctx.globalAlpha = particle.life;
            this.ctx.fillStyle = particle.color;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        });
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new GameClient();
});
