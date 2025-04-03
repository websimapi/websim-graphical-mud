import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Game State ---
const gameState = {
    currentRoom: null,
    player: {
        position: new THREE.Vector3(0, 1, 5), // Initial player position
        inventory: [],
    },
    rooms: {},
    npcs: {},
    conversationHistory: {}, // Store conversation history per NPC { npcId: [...] }
    interactingNPC: null,
};

// --- DOM Elements ---
const viewport = document.getElementById('viewport');
const chatLog = document.getElementById('chat-log');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const npcInteractionDiv = document.getElementById('npc-interaction');
const npcNameEl = document.getElementById('npc-name');
const npcDialogueEl = document.getElementById('npc-dialogue');
const playerResponseInput = document.getElementById('player-response');
const respondButton = document.getElementById('respond-button');


// --- Three.js Setup ---
let scene, camera, renderer, controls;

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa); // Light grey background

    camera = new THREE.PerspectiveCamera(75, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
    camera.position.copy(gameState.player.position); // Start camera at player pos
     camera.lookAt(0, 0, 0); // Look towards the center initially

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.appendChild(renderer.domElement);

    // Basic Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // Orbit Controls for basic navigation (can be replaced with character controller later)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI / 2; // Prevent looking straight down

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
    controls.update(); // only required if controls.enableDamping or controls.autoRotate are set to true
    renderer.render(scene, camera);
}

// --- Game Logic ---

async function createRoom(roomId, description, exits) {
     addChatMessage(`Generating visuals for ${roomId}...`, 'system-message');
    try {
         const texture = await generateRoomTexture(description);
         const roomGeometry = new THREE.BoxGeometry(20, 15, 20); // Example room size
         const roomMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
         const roomMesh = new THREE.Mesh(roomGeometry, roomMaterial);
         roomMesh.name = roomId; // Identify the mesh
         scene.add(roomMesh);

        gameState.rooms[roomId] = {
            id: roomId,
            description: description,
            exits: exits, // { north: 'other_room_id', west: 'another_room_id' }
            mesh: roomMesh,
            npcs: [], // NPCs currently in this room
        };
         addChatMessage(`Entered ${roomId}. ${description}`, 'system-message');

    } catch (error) {
        console.error("Error generating room texture:", error);
        addChatMessage(`Failed to generate visuals for ${roomId}. Using default.`, 'system-message');
         // Fallback to a simple colored room
        const roomGeometry = new THREE.BoxGeometry(20, 15, 20);
        const roomMaterial = new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.BackSide });
        const roomMesh = new THREE.Mesh(roomGeometry, roomMaterial);
        roomMesh.name = roomId;
        scene.add(roomMesh);
         gameState.rooms[roomId] = {
            id: roomId,
            description: description,
            exits: exits,
            mesh: roomMesh,
             npcs: [],
        };
         addChatMessage(`Entered ${roomId}. ${description}`, 'system-message');
    }
}

async function generateRoomTexture(description) {
    const prompt = `Fantasy MUD room texture, ${description}. Style of Meridian 59, low-poly, slightly pixelated, seamless tileable texture.`;
    try {
        const result = await websim.imageGen({
            prompt: prompt,
            width: 512, // Power of 2 for textures
            height: 512,
        });
        const textureLoader = new THREE.TextureLoader();
        return await textureLoader.loadAsync(result.url);
    } catch (error) {
        console.error("LLM Image Generation Error:", error);
        throw error; // Re-throw to handle in createRoom
    }
}


function addNPC(npcId, name, description, startingRoomId, dialogueStyle) {
     // For now, represent NPCs as simple spheres
    const npcGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const npcMaterial = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff }); // Random color
    const npcMesh = new THREE.Mesh(npcGeometry, npcMaterial);

    // Position the NPC within the room (example positioning)
     const room = gameState.rooms[startingRoomId];
     if (room && room.mesh) {
        // Place randomly within the room boundaries, avoiding center
         const roomSize = room.mesh.geometry.parameters;
         const xOffset = (Math.random() - 0.5) * (roomSize.width - 4) ; // Avoid edges
         const zOffset = (Math.random() - 0.5) * (roomSize.depth - 4);
         npcMesh.position.set(xOffset, 0.5, zOffset); // Place on the "floor"
     } else {
         npcMesh.position.set(Math.random() * 4 - 2, 0.5, Math.random() * 4 - 2); // Default position if room mesh not found
     }

     npcMesh.userData = { type: 'npc', id: npcId }; // Store NPC ID in mesh data
    scene.add(npcMesh); // Add NPC mesh to the main scene

    gameState.npcs[npcId] = {
        id: npcId,
        name: name,
        description: description,
        currentRoomId: startingRoomId,
        dialogueStyle: dialogueStyle, // e.g., "grumpy old wizard", "cheerful shopkeeper"
        mesh: npcMesh,
    };
     gameState.conversationHistory[npcId] = []; // Initialize conversation history

     if (room) {
        room.npcs.push(npcId); // Add NPC ID to the room's list
     }
}


function displayRoom(roomId) {
    if (!gameState.rooms[roomId]) {
        addChatMessage(`Error: Room "${roomId}" does not exist.`, 'system-message');
        return;
    }

    // Hide all existing room meshes and NPCs
    Object.values(gameState.rooms).forEach(room => {
        if (room.mesh) room.mesh.visible = false;
    });
     Object.values(gameState.npcs).forEach(npc => {
        if (npc.mesh) npc.mesh.visible = false;
    });


    // Show the target room mesh
    const targetRoom = gameState.rooms[roomId];
    if (targetRoom.mesh) {
        targetRoom.mesh.visible = true;
        gameState.currentRoom = targetRoom;
        addChatMessage(`You are in ${targetRoom.id}. ${targetRoom.description}`, 'system-message');

         // Show NPCs in the current room
         targetRoom.npcs.forEach(npcId => {
             const npc = gameState.npcs[npcId];
             if (npc && npc.mesh) {
                 npc.mesh.visible = true;
             }
         });

         // List exits
         let exits = Object.keys(targetRoom.exits);
         if (exits.length > 0) {
            addChatMessage(`Exits: ${exits.join(', ')}`, 'system-message');
         } else {
             addChatMessage(`There are no obvious exits.`, 'system-message');
         }

          // List NPCs
         if (targetRoom.npcs.length > 0) {
            const npcNames = targetRoom.npcs.map(id => gameState.npcs[id].name).join(', ');
             addChatMessage(`You see: ${npcNames}`, 'system-message');
         }


    } else {
        addChatMessage(`Error: Visuals for room "${roomId}" not loaded.`, 'system-message');
    }

     // Update camera/controls target if needed (e.g., center on room)
    controls.target.set(0, 0, 0); // Reset controls target to room center
    controls.update();
    hideNPCInteraction(); // Hide NPC panel when changing rooms
}


function processCommand(command) {
    addChatMessage(`> ${command}`, 'player-message');
    const parts = command.toLowerCase().split(' ');
    const action = parts[0];
    const target = parts.slice(1).join(' '); // Handle multi-word targets

    const currentRoom = gameState.currentRoom;
    if (!currentRoom) {
        addChatMessage("You are lost in the void.", 'system-message');
        return;
    }

    switch (action) {
        case 'look':
            displayRoom(currentRoom.id); // Re-describe the current room
            // Add detailed look logic later (e.g., look at npc/object)
            break;
        case 'go':
        case 'move':
             if (target && currentRoom.exits[target]) {
                 const nextRoomId = currentRoom.exits[target];
                displayRoom(nextRoomId);
            } else if (!target) {
                 addChatMessage("Go where?", 'system-message');
            } else {
                addChatMessage(`You can't go ${target} from here.`, 'system-message');
            }
            break;
        case 'talk':
             if (target) {
                 startInteraction(target);
             } else {
                addChatMessage("Talk to whom?", 'system-message');
             }
             break;
        case 'help':
            addChatMessage("Commands: look, go [direction], talk [npc name], help", 'system-message');
            break;
        default:
            addChatMessage("Unknown command.", 'system-message');
    }
}

function addChatMessage(message, type = 'system-message') {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', type);
    messageElement.textContent = message;
    chatLog.appendChild(messageElement);
    chatLog.scrollTop = chatLog.scrollHeight; // Auto-scroll
}

function addDialogueMessage(message, type = 'npc-message') {
    const messageElement = document.createElement('div');
    // Use chat-message styling but allow specific types
    messageElement.classList.add('chat-message', type);
    messageElement.textContent = message;
    npcDialogueEl.appendChild(messageElement);
    npcDialogueEl.scrollTop = npcDialogueEl.scrollHeight;
}


// --- NPC Interaction ---

function findNPCInCurrentRoom(npcName) {
    if (!gameState.currentRoom) return null;
    const lowerCaseName = npcName.toLowerCase();
    const npcId = gameState.currentRoom.npcs.find(id => gameState.npcs[id].name.toLowerCase() === lowerCaseName);
    return npcId ? gameState.npcs[npcId] : null;
}

function startInteraction(npcName) {
    const npc = findNPCInCurrentRoom(npcName);
    if (npc) {
        gameState.interactingNPC = npc;
        npcInteractionDiv.style.display = 'flex'; // Show the panel
        npcNameEl.textContent = `Talking to ${npc.name}`;
        npcDialogueEl.innerHTML = ''; // Clear previous dialogue

        // Add NPC description to dialogue start
        addDialogueMessage(`(${npc.description})`, 'system-message');

        // Optional: Fetch an initial greeting from the LLM?
         // For now, just show the panel and wait for player response.
         // Or, provide a default greeting:
         addDialogueMessage(`${npc.name}: Greetings, traveler. What can I do for you?`, 'npc-message');
         // Initialize or retrieve conversation history
        if (!gameState.conversationHistory[npc.id]) {
             gameState.conversationHistory[npc.id] = [];
        }
         // Add initial greeting to history
        gameState.conversationHistory[npc.id].push({ role: "assistant", content: "Greetings, traveler. What can I do for you?" });


    } else {
        addChatMessage(`There is no one named "${npcName}" here.`, 'system-message');
         hideNPCInteraction();
    }
}

function hideNPCInteraction() {
    gameState.interactingNPC = null;
    npcInteractionDiv.style.display = 'none';
    playerResponseInput.value = '';
     npcDialogueEl.innerHTML = '';
     npcNameEl.textContent = '';
}

async function sendResponseToNPC() {
     if (!gameState.interactingNPC) return;

    const playerMessage = playerResponseInput.value.trim();
    if (!playerMessage) return;

     const npc = gameState.interactingNPC;
    addDialogueMessage(`You: ${playerMessage}`, 'player-message');
    playerResponseInput.value = ''; // Clear input field

     // Add player message to history
     gameState.conversationHistory[npc.id].push({ role: "user", content: playerMessage });
     // Keep history relatively short
     gameState.conversationHistory[npc.id] = gameState.conversationHistory[npc.id].slice(-10);


    try {
        // Show typing indicator (optional)
        addDialogueMessage(`${npc.name} is thinking...`, 'system-message');
        npcDialogueEl.scrollTop = npcDialogueEl.scrollHeight;


        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are ${npc.name}, a character in a fantasy MUD. Your personality is: ${npc.dialogueStyle}. The player is interacting with you. Keep responses relatively brief and in character. Current room description: ${gameState.currentRoom.description}.`
                },
                ...gameState.conversationHistory[npc.id] // Include past conversation
            ],
        });

        const npcResponse = completion.content;

        // Remove typing indicator (find and remove the specific message)
        const thinkingMsg = Array.from(npcDialogueEl.children).find(el => el.textContent.includes('is thinking...'));
        if (thinkingMsg) thinkingMsg.remove();


        addDialogueMessage(`${npc.name}: ${npcResponse}`, 'npc-message');
         // Add NPC response to history
         gameState.conversationHistory[npc.id].push({ role: "assistant", content: npcResponse });


    } catch (error) {
        console.error("LLM Chat Error:", error);
        addDialogueMessage(`(${npc.name} seems lost in thought...)`, 'system-message');
         // Optionally remove thinking message here too
         const thinkingMsg = Array.from(npcDialogueEl.children).find(el => el.textContent.includes('is thinking...'));
         if (thinkingMsg) thinkingMsg.remove();
    }
}


// --- Event Listeners ---
sendButton.addEventListener('click', () => {
    const command = userInput.value.trim();
    if (command) {
        processCommand(command);
        userInput.value = ''; // Clear input field
    }
});

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click(); // Trigger button click on Enter
    }
});

respondButton.addEventListener('click', sendResponseToNPC);

playerResponseInput.addEventListener('keypress', (event) => {
     if (event.key === 'Enter') {
         respondButton.click();
     }
 });


// --- Game Initialization ---
async function initializeGame() {
    addChatMessage("Welcome to the Graphical MUD!", 'system-message');
    initThree();

     // Create starting room and potentially others
    await createRoom('tavern', 'a cozy but dimly lit tavern room. A large fireplace crackles in the corner. The smell of ale hangs heavy in the air.', { north: 'town_square' });
     await createRoom('town_square', 'a bustling town square. Merchants hawk their wares, and guards patrol the perimeter. A fountain bubbles in the center.', { south: 'tavern', west: 'alley' });
     await createRoom('alley', 'a narrow, damp alleyway littered with refuse. It smells unpleasant.', { east: 'town_square' });


     // Add NPCs
     addNPC('barkeep', 'Barkeep Bill', 'A stout, friendly man cleaning a mug behind the bar.', 'tavern', 'a friendly, slightly gruff tavern owner. Likes gossip.');
     addNPC('guard', 'Guard Gregor', 'A stern-looking guard in city watch armor, keeping an eye on things.', 'town_square', 'a dutiful, bored town guard. Speaks formally.');


    // Start player in the tavern
    displayRoom('tavern');
}

initializeGame();

