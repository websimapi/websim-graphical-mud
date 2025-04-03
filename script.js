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
        npcMesh.visible = (gameState.currentRoom?.id === startingRoomId); // Option 2: Manage visibility
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
/**
 * Parses text containing M59-style color/style codes (~n, ~I, ~U, ~B, ~b, ~g, ~r, ~k)
 * and returns an HTML string with appropriate <span class="..."> tags.
 * It handles stacked styles and resets. Invalid codes are treated as literal text.
 * Text content within segments is automatically HTML-sanitized.
 * @param {string} text The input text with style codes.
 * @returns {string} HTML string with styles applied.
 */
function parseColoredText(text) {
    let html = '';
    let currentStyles = {
        italic: false,
        underline: false,
        bold: false,
        color: null, // Store the class name directly e.g., 'text-blue'
    };
    let i = 0;

    // Helper function to apply current styles to a text segment and sanitize it
    function applyStyles(segment) {
        // Sanitize the text segment first
        const safeSegment = segment
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        // If no styles are active, return the sanitized segment directly
        if (!currentStyles.italic && !currentStyles.underline && !currentStyles.bold && !currentStyles.color) {
            return safeSegment;
        }

        // Build class list based on active styles
        let classes = [];
        if (currentStyles.italic) classes.push('text-italic');
        if (currentStyles.underline) classes.push('text-underline');
        if (currentStyles.bold) classes.push('text-bold');
        if (currentStyles.color) classes.push(currentStyles.color);

        // Wrap the sanitized segment in a span with the classes
        return `<span class="${classes.join(' ')}">${safeSegment}</span>`;
    }

    // Iterate through the input text
    while (i < text.length) {
        let segmentStart = i;
        // Find the next style code '~' or the end of the string
        while (i < text.length && text[i] !== '~') {
            i++;
        }

        // If we found a text segment before the '~' or end, apply styles to it
        if (i > segmentStart) {
            html += applyStyles(text.substring(segmentStart, i));
        }

        // Process the style code if found ('~' followed by a character)
        if (i < text.length && text[i] === '~' && i + 1 < text.length) {
            const code = text[i + 1];
            let styleApplied = true;
            switch (code) {
                case 'n': // Reset ALL styles
                    currentStyles = { italic: false, underline: false, bold: false, color: null };
                    break;
                case 'I': currentStyles.italic = true; break; // Turns ON italic
                case 'U': currentStyles.underline = true; break; // Turns ON underline
                case 'B': currentStyles.bold = true; break; // Turns ON bold
                case 'b': currentStyles.color = 'text-blue'; break; // SETS color to blue
                case 'g': currentStyles.color = 'text-green'; break; // SETS color to green
                case 'r': currentStyles.color = 'text-red'; break; // SETS color to red
                case 'k': currentStyles.color = 'text-black'; break; // SETS color to black
                default:
                    // Invalid code, treat '~' and the next char as literal text
                    // Apply current styles to these literal characters
                    html += applyStyles('~' + code);
                    styleApplied = false; // Mark as not a valid style change
                    break;
            }
            i += 2; // Skip '~' and the code character (or the two literal characters)
        } else if (i < text.length && text[i] === '~') {
            // Dangling '~' at the end of the string, treat as literal
            html += applyStyles('~');
            i++;
        }
        // Otherwise, we are at the end of the string, loop will terminate
    } // end while loop

    return html;
}


// --- Chat Handling ---
/**
 * Adds a message to the chat log.
 * @param {string} message The text content of the message.
 * @param {string} [type='system-message'] CSS class for message styling (e.g., 'player-say', 'npc-say').
 * @param {boolean} [parseColors=false] If true, parse M59-style color codes (~b, ~I, etc.). If false, sanitize HTML.
 */
function addChatMessage(message, type = 'system-message', parseColors = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', type);

    // Apply parsing *or* basic sanitization if not parsing
    if (parseColors) {
        // parseColoredText handles its own sanitization for text segments
        messageElement.innerHTML = parseColoredText(message);
    } else {
        // Sanitize the entire message if not parsing colors
        const safeMessage = message
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        messageElement.innerHTML = safeMessage;
    }

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
    // Extract message components carefully
    const message = command.substring(command.indexOf(' ') + 1).trim(); // For s, e, y, b - gets everything after first space
    const messageArgs = parts.slice(1); // Array of args after command
    const messageWithTarget = parts.slice(2).join(' '); // For commands like t target message


    // ... (rest of the function before the switch) ...

    switch (action) {
        // ... (other cases) ...

        case 's': // Say
            if (!message) { addChatMessage("Say what?", 'error-message'); break; }
            // Display player saying it first, parsing colors
            // addChatMessage handles the parsing and sanitization when parseColors is true
            addChatMessage(`${gameState.player.name} says, "${message}"`, 'player-say', true);

            // If currently interacting, also send to NPC LLM
            if (gameState.interactingNPC) {
                // Pass the ORIGINAL message (unparsed) to the LLM for context
                await getNPCResponse(gameState.interactingNPC, message);
            }
            break;

        // ... (other cases) ...
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