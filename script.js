import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Game State ---
const gameState = {
    currentRoom: null,
    player: {
        name: "Player", // Default player name
        position: new THREE.Vector3(0, 1, 5), // Initial player position
        inventory: [],
    },
    rooms: {},
    npcs: {},
    conversationHistory: {}, // Store conversation history per NPC { npcId: [...] }
    interactingNPC: null, // NPC the player last 'talk'ed to
};

// --- DOM Elements ---
const viewport = document.getElementById('viewport');
const chatLog = document.getElementById('chat-log');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');

// --- Three.js Setup (mostly unchanged) ---
let scene, camera, renderer, controls;

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2d2d2d); // Darker grey background

    camera = new THREE.PerspectiveCamera(75, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
    camera.position.copy(gameState.player.position);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Slightly dimmer ambient
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 50; // Increased max distance
    controls.maxPolarAngle = Math.PI / 1.9; // Allow looking slightly further down


    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// --- Game Logic ---

async function createRoom(roomId, description, exits) {
    addChatMessage(`Generating visuals for ${roomId}...`, 'system-message');
    try {
        const texture = await generateRoomTexture(description);
        const roomGeometry = new THREE.BoxGeometry(30, 20, 30); // Larger rooms
        const roomMaterial = new THREE.MeshStandardMaterial({ // Use StandardMaterial for lighting
            map: texture,
            side: THREE.BackSide,
            roughness: 0.8, // Less shiny
            metalness: 0.2
        });
        const roomMesh = new THREE.Mesh(roomGeometry, roomMaterial);
        roomMesh.name = roomId;
        roomMesh.position.y = roomMesh.geometry.parameters.height / 2 - 1; // Adjust floor level if needed
        scene.add(roomMesh);

        gameState.rooms[roomId] = {
            id: roomId,
            description: description,
            exits: exits,
            mesh: roomMesh,
            npcs: [],
            items: [], // Add items array
        };
        // Don't add "Entered..." message here, displayRoom handles it

    } catch (error) {
        console.error("Error generating room texture:", error);
        addChatMessage(`Failed to generate visuals for ${roomId}. Using default.`, 'error-message');
        const roomGeometry = new THREE.BoxGeometry(30, 20, 30);
        const roomMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, side: THREE.BackSide, roughness: 0.9 });
        const roomMesh = new THREE.Mesh(roomGeometry, roomMaterial);
        roomMesh.name = roomId;
        roomMesh.position.y = roomMesh.geometry.parameters.height / 2 - 1;
        scene.add(roomMesh);
        gameState.rooms[roomId] = {
            id: roomId,
            description: description,
            exits: exits,
            mesh: roomMesh,
            npcs: [],
            items: [],
        };
        // Don't add "Entered..." message here
    }
}

async function generateRoomTexture(description) {
    // Adjusted prompt for better tiling and style
    const prompt = `Seamless, tileable texture for a fantasy MUD room wall/floor. Style: retro 3D, like Meridian 59 or EverQuest, low-poly aesthetic, slightly pixelated but clear. Description: ${description}`;
    try {
        const result = await websim.imageGen({
            prompt: prompt,
            width: 1024, // Larger texture size
            height: 1024,
        });
        const textureLoader = new THREE.TextureLoader();
        const texture = await textureLoader.loadAsync(result.url);
        texture.wrapS = THREE.RepeatWrapping; // Enable tiling
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 4); // Adjust tiling factor as needed
        return texture;
    } catch (error) {
        console.error("LLM Image Generation Error:", error);
        throw error;
    }
}

function addNPC(npcId, name, description, startingRoomId, dialogueStyle, isBanker = false) {
    // Simple capsule for NPC representation
    const npcGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8); // Radius, height
    const npcMaterial = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xaaaaaa + 0x444444, // Less saturated random colors
        roughness: 0.7
    });
    const npcMesh = new THREE.Mesh(npcGeometry, npcMaterial);
    npcMesh.position.y = 0.9; // Position capsule base near floor (y=0)

    const room = gameState.rooms[startingRoomId];
    if (room && room.mesh) {
        const roomSize = room.mesh.geometry.parameters;
        const xOffset = (Math.random() - 0.5) * (roomSize.width - 6); // Avoid edges
        const zOffset = (Math.random() - 0.5) * (roomSize.depth - 6);
        npcMesh.position.x = xOffset;
        npcMesh.position.z = zOffset;
    } else {
        npcMesh.position.set(Math.random() * 6 - 3, 0.9, Math.random() * 6 - 3);
    }

    npcMesh.userData = { type: 'npc', id: npcId };
    scene.add(npcMesh);

    gameState.npcs[npcId] = {
        id: npcId,
        name: name,
        description: description,
        currentRoomId: startingRoomId,
        dialogueStyle: dialogueStyle,
        mesh: npcMesh,
        isBanker: isBanker, // Mark if NPC is a banker
        balance: isBanker ? 1000 : 0 // Example starting balance for banker
    };
    gameState.conversationHistory[npcId] = [];

    if (room) {
        room.npcs.push(npcId);
        // Add NPC mesh as a child of the room mesh ONLY IF rooms don't move
        // If rooms might move/unload, keep NPCs in the main scene and manage visibility
        // room.mesh.add(npcMesh); // Option 1: Child of room
        npc.mesh.visible = (gameState.currentRoom?.id === startingRoomId); // Option 2: Manage visibility
    }
}

function displayRoom(roomId) {
    if (!gameState.rooms[roomId]) {
        addChatMessage(`Error: Room "${roomId}" does not exist.`, 'error-message');
        return;
    }

    const previousRoom = gameState.currentRoom;
    const targetRoom = gameState.rooms[roomId];

    // Hide previous room and its NPCs if different
    if (previousRoom && previousRoom.id !== roomId) {
        if (previousRoom.mesh) previousRoom.mesh.visible = false;
        previousRoom.npcs.forEach(npcId => {
            const npc = gameState.npcs[npcId];
            if (npc && npc.mesh) npc.mesh.visible = false;
        });
    }

    // Show the target room mesh
    if (targetRoom.mesh) {
        targetRoom.mesh.visible = true;
        gameState.currentRoom = targetRoom;

        // --- Display Room Information ---
        addChatMessage(`[${targetRoom.id}]`, 'look-description'); // Room ID
        addChatMessage(targetRoom.description, 'look-description'); // Description

        // List exits
        let exits = Object.keys(targetRoom.exits);
        if (exits.length > 0) {
            addChatMessage(`Exits: ${exits.join(', ')}`, 'look-exits');
        } else {
            addChatMessage(`There are no obvious exits.`, 'look-exits');
        }

        // List NPCs
        if (targetRoom.npcs.length > 0) {
            const npcDescriptions = targetRoom.npcs.map(id => {
                const npc = gameState.npcs[id];
                return `${npc.name} (${npc.description})`;
            }).join('\n');
            addChatMessage(`You see:\n${npcDescriptions}`, 'look-npcs');
        }

        // List Items (Placeholder)
        if (targetRoom.items.length > 0) {
            // TODO: Add item display logic
            addChatMessage(`On the ground: ${targetRoom.items.join(', ')}`, 'look-items');
        }
        // --- End Display Room Information ---


        // Show NPCs in the current room
        targetRoom.npcs.forEach(npcId => {
            const npc = gameState.npcs[npcId];
            if (npc && npc.mesh) {
                npc.mesh.visible = true;
                // Ensure NPC is positioned correctly relative to the room if added to main scene
                if (!targetRoom.mesh.children.includes(npc.mesh)) {
                    // Calculate position within the room if needed (already done in addNPC)
                }
            }
        });

    } else {
        addChatMessage(`Error: Visuals for room "${roomId}" not loaded.`, 'error-message');
        gameState.currentRoom = targetRoom; // Still set logical current room
    }

    // Reset interaction state when changing rooms
    if (previousRoom?.id !== roomId) {
        gameState.interactingNPC = null;
    }

    controls.target.set(0, targetRoom.mesh?.position.y || 0, 0); // Center view roughly
    controls.update();
}

// --- Text Formatting ---
function parseColoredText(text) {
    let html = '';
    let currentStyles = {
        italic: false,
        underline: false,
        bold: false,
        color: null,
    };
    let currentSpanOpen = false;

    function openSpanIfNeeded() {
        if (currentSpanOpen) return;
        let classes = [];
        if (currentStyles.italic) classes.push('text-italic');
        if (currentStyles.underline) classes.push('text-underline');
        if (currentStyles.bold) classes.push('text-bold');
        if (currentStyles.color) classes.push(currentStyles.color);
        if (classes.length > 0) {
            html += `<span class="${classes.join(' ')}">`;
            currentSpanOpen = true;
        }
    }

    function closeSpanIfNeeded() {
        if (currentSpanOpen) {
            html += '</span>';
            currentSpanOpen = false;
        }
    }

    for (let i = 0; i < text.length; i++) {
        if (text[i] === '~' && i + 1 < text.length) {
            closeSpanIfNeeded(); // Close current span before changing style
            const code = text[i + 1];
            let styleChanged = true;
            switch (code) {
                case 'n': // Reset
                    currentStyles = { italic: false, underline: false, bold: false, color: null };
                    break;
                case 'I': currentStyles.italic = !currentStyles.italic; break; // Toggle italic (M59 might just turn on)
                case 'U': currentStyles.underline = !currentStyles.underline; break; // Toggle underline
                case 'B': currentStyles.bold = !currentStyles.bold; break; // Toggle bold
                case 'b': currentStyles.color = 'text-blue'; break;
                case 'g': currentStyles.color = 'text-green'; break;
                case 'r': currentStyles.color = 'text-red'; break;
                case 'k': currentStyles.color = 'text-black'; break;
                default:
                    styleChanged = false; // Not a valid code, treat as literal '~' + char
                    html += text[i]; // Output the '~'
                    break; // Continue loop to output the next char
            }
            if (styleChanged) {
                i++; // Skip the style code character
                openSpanIfNeeded(); // Open new span with updated styles
            }

        } else {
            openSpanIfNeeded(); // Ensure span is open if needed for current char
            html += text[i]; // Append normal character
        }
    }
    closeSpanIfNeeded(); // Close any remaining open span
    return html;
}

// --- Chat Handling ---
function addChatMessage(message, type = 'system-message', parseColors = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', type);
    // Sanitize basic HTML, then apply coloring if requested
    const safeMessage = message // Basic sanitization
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    messageElement.innerHTML = parseColors ? parseColoredText(safeMessage) : safeMessage;
    chatLog.appendChild(messageElement);
    chatLog.scrollTop = chatLog.scrollHeight; // Auto-scroll
}


// --- NPC Interaction (LLM) ---
async function getNPCResponse(npc, playerMessage) {
    if (!npc) return null;

    addChatMessage(`You say to ${npc.name}, "${playerMessage}"`, 'player-say'); // Show player's dialogue

    // Add player message to history
    gameState.conversationHistory[npc.id].push({ role: "user", content: playerMessage });
    // Keep history relatively short
    gameState.conversationHistory[npc.id] = gameState.conversationHistory[npc.id].slice(-12); // Slightly longer history

    try {
        addChatMessage(`${npc.name} is thinking...`, 'system-message'); // Simple thinking indicator

        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are ${npc.name}, a character in a fantasy MUD game reminiscent of Meridian 59. Your personality is: ${npc.dialogueStyle}. The player (${gameState.player.name}) is talking to you in the location: ${gameState.currentRoom.description}. Keep responses concise, in character, and suitable for a MUD chat interface. Avoid conversational fillers unless it fits the character. You can respond to greetings, questions, and basic statements.`
                },
                ...gameState.conversationHistory[npc.id] // Include past conversation
            ],
        });

        let npcResponse = completion.content;

        // Basic filtering/cleanup (optional)
        npcResponse = npcResponse.replace(/^"|"$/g, ''); // Remove surrounding quotes if LLM adds them

        // Remove thinking indicator (find and remove the specific message)
        const thinkingMsg = Array.from(chatLog.children).find(el => el.textContent.includes('is thinking...'));
        if (thinkingMsg) thinkingMsg.remove();

        addChatMessage(`${npc.name} says, "${npcResponse}"`, 'npc-say');

        // Add NPC response to history
        gameState.conversationHistory[npc.id].push({ role: "assistant", content: npcResponse });

        return npcResponse; // Return for potential further processing

    } catch (error) {
        console.error("LLM Chat Error:", error);
        const thinkingMsg = Array.from(chatLog.children).find(el => el.textContent.includes('is thinking...'));
        if (thinkingMsg) thinkingMsg.remove();
        addChatMessage(`(${npc.name} seems unresponsive.)`, 'system-message');
        return null;
    }
}

// --- Command Processing ---
function findNPCInCurrentRoomByName(npcName) {
    if (!gameState.currentRoom) return null;
    const lowerCaseName = npcName.toLowerCase();
    const npcId = gameState.currentRoom.npcs.find(id => gameState.npcs[id].name.toLowerCase() === lowerCaseName);
    return npcId ? gameState.npcs[npcId] : null;
}

async function processCommand(command) {
    const parts = command.trim().split(' ');
    const action = parts[0]?.toLowerCase();
    const arg1 = parts[1];
    const arg2 = parts[2];
    const message = parts.slice(1).join(' '); // For commands like s, e, y, b
    const messageWithTarget = parts.slice(2).join(' '); // For commands like t target message

    const currentRoom = gameState.currentRoom;
    if (!currentRoom && action !== 'help') { // Allow help even if lost
        addChatMessage("You are lost in the void.", 'error-message');
        return;
    }

    // Commands that break NPC interaction focus
    const breakInteractionCommands = ['look', 'go', 'move', 'get', 'drop', 'put', 'rest', 'stand', 'map', 'who', 'mail', 'alias', 'buy', 'offer', 'deposit', 'withdraw', 'balance'];
    if (breakInteractionCommands.includes(action)) {
        if (gameState.interactingNPC) {
            // addChatMessage(`You stop talking to ${gameState.interactingNPC.name}.`, 'system-message'); // Optional feedback
            gameState.interactingNPC = null;
        }
    }

    switch (action) {
        // --- Basic Commands ---
        case 'e': // Emote
            if (!message) { addChatMessage("Emote what?", 'error-message'); break; }
            addChatMessage(`${gameState.player.name} ${message}`, 'player-emote', true); // Parse colors
            break;
        case 's': // Say
            if (!message) { addChatMessage("Say what?", 'error-message'); break; }
            // Display player saying it first
            const formattedSay = parseColoredText(message); // Parse colors immediately
            addChatMessage(`${gameState.player.name} says, "${formattedSay}"`, 'player-say'); // Display with parsed colors

            // If currently interacting, also send to NPC LLM
            if (gameState.interactingNPC) {
                await getNPCResponse(gameState.interactingNPC, message); // Pass original message for LLM context
            }
            break;
        case 't': // Tell
            if (!arg1 || !messageWithTarget) { addChatMessage("Usage: t <player/npc> <message>", 'error-message'); break; }
            // For now, only simulate sending. Find target NPC/Player later.
            addChatMessage(`You tell ${arg1}, "${messageWithTarget}"`, 'player-tell-sent', true);
            // TODO: Implement actual sending or NPC interaction if target is NPC
            break;
        case 'y': // Yell
            if (!message) { addChatMessage("Yell what?", 'error-message'); break; }
            addChatMessage(`${gameState.player.name} yells, "${message}"`, 'player-yell', true); // Parse colors
            // TODO: Implement wider range than current room later
            break;
        case 'b': // Broadcast
            if (!message) { addChatMessage("Broadcast what?", 'error-message'); break; }
            addChatMessage(`${gameState.player.name} broadcasts, "${message}"`, 'player-broadcast', true); // Parse colors
            // TODO: Implement server-wide broadcast later
            break;

        // --- Interaction Commands ---
        case 'get':
            if (!arg1) { addChatMessage("Get what?", 'error-message'); break; }
            addChatMessage(`You try to get the ${arg1}.`, 'system-message');
            // TODO: Implement item pickup logic
            break;
        case 'drop':
            if (!arg1) { addChatMessage("Drop what?", 'error-message'); break; }
            addChatMessage(`You drop the ${arg1}.`, 'system-message');
            // TODO: Implement item drop logic
            break;
        case 'offer': // offer item to target
            if (!arg1 || !arg2 || parts[2]?.toLowerCase() !== 'to' || !parts[3]) { addChatMessage("Usage: offer <item> to <target>", 'error-message'); break; }
            const offerItem = arg1;
            const offerTargetName = parts.slice(3).join(' ');
            const offerTargetNpc = findNPCInCurrentRoomByName(offerTargetName);
            if (offerTargetNpc) {
                addChatMessage(`You offer the ${offerItem} to ${offerTargetNpc.name}.`, 'system-message');
                // TODO: Implement NPC offer reaction (maybe LLM?)
            } else {
                addChatMessage(`There is no one here named "${offerTargetName}".`, 'error-message');
            }
            break;
        case 'buy': // buy item from npc
            if (!arg1 || !arg2 || parts[2]?.toLowerCase() !== 'from' || !parts[3]) { addChatMessage("Usage: buy <item> from <npc>", 'error-message'); break; }
            const buyItem = arg1;
            const buyVendorName = parts.slice(3).join(' ');
            const buyVendorNpc = findNPCInCurrentRoomByName(buyVendorName);
            if (buyVendorNpc) {
                addChatMessage(`You try to buy the ${buyItem} from ${buyVendorNpc.name}.`, 'system-message');
                // TODO: Implement buy logic
            } else {
                addChatMessage(`There is no one here named "${buyVendorName}".`, 'error-message');
            }
            break;
        case 'put': // put item in container
            if (!arg1 || !arg2 || parts[2]?.toLowerCase() !== 'in' || !parts[3]) { addChatMessage("Usage: put <item> in <container>", 'error-message'); break; }
            const putItem = arg1;
            const containerName = parts.slice(3).join(' ');
            addChatMessage(`You try to put the ${putItem} in the ${containerName}.`, 'system-message');
            // TODO: Implement container logic
            break;

        // --- Animations ---
        case 'wave': addChatMessage("You wave.", 'player-emote'); break;
        case 'point': addChatMessage("You point.", 'player-emote'); break; // add target later?
        case 'happy': addChatMessage("You look happy.", 'player-emote'); break;
        case 'sad': addChatMessage("You look sad.", 'player-emote'); break;
        case 'neutral': addChatMessage("You look neutral.", 'player-emote'); break;
        case 'wry': addChatMessage("You look wry.", 'player-emote'); break;

        // --- Character Interaction ---
        case 'rest': addChatMessage("You sit down to rest.", 'system-message'); /* TODO: Add vigor regen */ break;
        case 'stand': addChatMessage("You stand up.", 'system-message'); break;
        case 'cast':
            if (!message) { addChatMessage("Cast what spell?", 'error-message'); break; }
            // Handle quoted spell names
            let spellName = message;
            if (message.startsWith('"') && message.endsWith('"')) {
                spellName = message.slice(1, -1);
            }
            addChatMessage(`You attempt to cast ${spellName}...`, 'system-message');
            // TODO: Implement spell casting system
            break;

        // --- Open Dialogs ---
        case 'alias': addChatMessage("Alias dialog not implemented.", 'system-message'); break;
        case 'who': addChatMessage("Who list not implemented.", 'system-message'); break;
        case 'map': addChatMessage("Map view not implemented.", 'system-message'); break;
        case 'mail': addChatMessage("Mail system not implemented.", 'system-message'); break;
        case 'help':
            addChatMessage(
                `--- Help ---
Basic: e[mote] text, s[ay] text, t[ell] target msg, y[ell] text, b[roadcast] text
Movement: go [direction] (e.g., go north)
Interaction: look, get [item], drop [item], offer [item] to [npc], buy [item] from [npc], put [item] in [container], talk [npc]
Character: rest, stand, cast "[spell name]"
Animations: wave, point, happy, sad, neutral, wry
Other: who, map, mail, alias, help
Banking (near banker): deposit [amount], withdraw [amount], balance
Text Colors: ~n(reset), ~I(italic), ~U(underline), ~B(bold), ~b(blue), ~g(green), ~r(red), ~k(black)
---`, 'info-message');
            break;

        // --- Banking Commands ---
        case 'deposit':
        case 'withdraw':
        case 'balance':
            const banker = currentRoom?.npcs.map(id => gameState.npcs[id]).find(npc => npc.isBanker);
            if (banker) {
                if (action === 'deposit') {
                    const amount = parseInt(arg1);
                    if (!isNaN(amount) && amount > 0) {
                        addChatMessage(`You ask ${banker.name} to deposit ${amount}.`, 'system-message');
                        // TODO: Implement currency system
                        addChatMessage(`${banker.name} says, "Certainly. Your balance is now ${banker.balance}."`, 'npc-say');
                    } else {
                        addChatMessage("Deposit how much?", 'error-message');
                    }
                } else if (action === 'withdraw') {
                    const amount = parseInt(arg1);
                    if (!isNaN(amount) && amount > 0) {
                        addChatMessage(`You ask ${banker.name} to withdraw ${amount}.`, 'system-message');
                        // TODO: Implement currency system
                        addChatMessage(`${banker.name} says, "Alright. You now have ${banker.balance} left."`, 'npc-say');
                    } else {
                        addChatMessage("Withdraw how much?", 'error-message');
                    }
                } else { // balance
                    addChatMessage(`You ask ${banker.name} about your balance.`, 'system-message');
                    addChatMessage(`${banker.name} says, "Your current balance is ${banker.balance}."`, 'npc-say');
                }
            } else {
                addChatMessage("You need to be near a banker to do that.", 'error-message');
            }
            break;

        // --- Core MUD Commands ---
        case 'look':
            if (arg1) {
                // Look at specific thing (NPC, item, etc.)
                const targetNpc = findNPCInCurrentRoomByName(message);
                if (targetNpc) {
                    addChatMessage(`You look at ${targetNpc.name}.\n(${targetNpc.description})`, 'look-description');
                    // Optionally trigger an LLM description?
                } else {
                    addChatMessage(`You see no '${message}' here.`, 'system-message');
                }
                // TODO: Implement looking at items/features
            } else {
                displayRoom(currentRoom.id); // Re-describe the current room
            }
            break;
        case 'go':
        case 'move':
            const direction = arg1;
            if (direction && currentRoom.exits[direction]) {
                const nextRoomId = currentRoom.exits[direction];
                addChatMessage(`You go ${direction}...`, 'system-message');
                displayRoom(nextRoomId);
            } else if (!direction) {
                addChatMessage("Go where? (north, south, east, west, etc.)", 'error-message');
            } else {
                addChatMessage(`You can't go ${direction} from here.`, 'error-message');
            }
            break;
        case 'talk':
            if (!message) { addChatMessage("Talk to whom?", 'error-message'); break; }
            const npcToTalk = findNPCInCurrentRoomByName(message);
            if (npcToTalk) {
                addChatMessage(`You approach ${npcToTalk.name}.`, 'system-message');
                gameState.interactingNPC = npcToTalk;
                // Get an initial greeting from the NPC
                await getNPCResponse(npcToTalk, "(approaches and wants to talk)"); // Use a placeholder action for initial prompt
            } else {
                addChatMessage(`There is no one named "${message}" here.`, 'error-message');
                gameState.interactingNPC = null; // Ensure interaction stops if target not found
            }
            break;

        default:
            // If not a known command AND interacting with an NPC, treat as 'say'
            if (gameState.interactingNPC && command) {
                // Re-process as 's command'
                await processCommand(`s ${command}`);
            } else if (command) { // Only show unknown if it wasn't blank
                addChatMessage(`Unknown command: "${action}"`, 'error-message');
            }
    }
}

// --- Event Listeners ---
sendButton.addEventListener('click', () => {
    const command = userInput.value; // Don't trim here, commands might need spaces
    if (command) { // Check if not empty
        processCommand(command);
        userInput.value = ''; // Clear input field
    }
});

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click(); // Trigger button click on Enter
    }
});

// --- Game Initialization ---
async function initializeGame() {
    addChatMessage("Welcome to Graphical MUD!", 'system-message');
    initThree();

    // Create rooms
    await createRoom('tavern', 'a cozy but dimly lit tavern room. A large fireplace crackles merrily. Wooden tables and chairs are scattered around. The air smells of ale and sawdust.', { north: 'town_square', east: 'kitchen' });
    await createRoom('town_square', 'a bustling town square paved with cobblestones. Merchants hawk their wares from colorful stalls. Guards patrol the perimeter. A fountain bubbles in the center.', { south: 'tavern', west: 'alley', east: 'market_street' });
    await createRoom('alley', 'a narrow, damp alleyway littered with refuse between tall buildings. It smells unpleasant, and shadows cling to the corners.', { east: 'town_square' });
    await createRoom('kitchen', 'a hot, steamy kitchen filled with the sounds of chopping and sizzling. Pots hang from the ceiling, and sacks of flour lean against the wall.', { west: 'tavern' });
    await createRoom('market_street', 'a wide street lined with shops. Signs for a baker, a blacksmith, and an apothecary are visible.', { west: 'town_square', north: 'bank' });
    await createRoom('bank', 'a sturdy stone building with barred windows. Inside, a polished counter separates you from the clerks. It feels secure.', { south: 'market_street' });


    // Add NPCs
    addNPC('barkeep', 'Barkeep Bill', 'A stout, friendly-looking man with a bushy mustache, wiping down the bar.', 'tavern', 'a friendly, slightly gruff tavern owner. Loves local gossip, knows who comes and goes.');
    addNPC('cook', 'Cook Peggy', 'A round woman with flour dusting her apron, bustling around the kitchen.', 'kitchen', 'a busy, slightly stressed cook. Doesn\'t like interruptions but might trade food for favors.');
    addNPC('guard', 'Guard Gregor', 'A tall, stern-faced guard in city watch armor, standing alert.', 'town_square', 'a dutiful, by-the-book town guard. Speaks formally, concerned with law and order.');
    addNPC('shadyfigure', 'Shady Figure', 'A figure lurking in the shadows of the alley, cloaked and keeping their face hidden.', 'alley', 'a suspicious, tight-lipped individual. Speaks in short, cryptic sentences. Might offer illicit deals.');
    addNPC('banker', 'Banker Thomas', 'A prim clerk wearing spectacles, sitting behind the counter.', 'bank', 'a polite but formal bank clerk. Focused on money and procedures.', true); // isBanker = true


    // Start player in the tavern
    displayRoom('tavern');
    addChatMessage("Type 'help' for a list of commands.", 'info-message');
}

initializeGame();