import { displayRoom as sceneDisplayRoom, addNPCToScene, removeNPCFromScene, ensureRoomIsGenerated } from '/sceneManager.js';
import { initThreeScene } from '/sceneManager.js';

// --- Game State ---
export const gameState = {
    currentRoom: null,
    player: {
        name: "Player",
        position: { x: 0, y: 1, z: 5 }, 
        inventory: [],
        balance: 100, 
    },
    rooms: {}, 
    npcs: {}, 
    conversationHistory: {}, 
    interactingNPC: null,
};

// --- DOM Elements ---
export const chatLog = document.getElementById('chat-log');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');

// --- Utility ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Chat Handling ---
/**
 * Parses text containing M59-style color/style codes (~n, ~I, ~U, ~B, ~b, ~g, ~r, ~k)
 * and returns an HTML string with appropriate <span class="..."> tags.
 * It handles stacked styles and resets. Invalid codes are treated as literal text.
 * Text content within segments is automatically HTML-sanitized.
 * @param {string} text The input text with style codes.
 * @returns {string} HTML string with styles applied.
 */
export function parseColoredText(text) {
    let html = '';
    let currentStyles = {
        italic: false,
        underline: false,
        bold: false,
        color: null, 
    };
    let i = 0;

    function applyStyles(segment) {
        const safeSegment = segment
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        if (!currentStyles.italic && !currentStyles.underline && !currentStyles.bold && !currentStyles.color) {
            return safeSegment;
        }

        let classes = [];
        if (currentStyles.italic) classes.push('text-italic');
        if (currentStyles.underline) classes.push('text-underline');
        if (currentStyles.bold) classes.push('text-bold');
        if (currentStyles.color) classes.push(currentStyles.color);

        return `<span class="${classes.join(' ')}">${safeSegment}</span>`;
    }

    while (i < text.length) {
        let segmentStart = i;
        while (i < text.length && text[i] !== '~') {
            i++;
        }

        if (i > segmentStart) {
            html += applyStyles(text.substring(segmentStart, i));
        }

        if (i < text.length && text[i] === '~' && i + 1 < text.length) {
            const code = text[i + 1];
            let styleApplied = true;
            switch (code) {
                case 'n': 
                    currentStyles = { italic: false, underline: false, bold: false, color: null };
                    break;
                case 'I': currentStyles.italic = true; break; 
                case 'U': currentStyles.underline = true; break; 
                case 'B': currentStyles.bold = true; break; 
                case 'b': currentStyles.color = 'text-blue'; break; 
                case 'g': currentStyles.color = 'text-green'; break; 
                case 'r': currentStyles.color = 'text-red'; break; 
                case 'k': currentStyles.color = 'text-black'; break; 
                default:
                    html += applyStyles('~' + code);
                    styleApplied = false; 
                    break;
            }
            i += 2; 
        } else if (i < text.length && text[i] === '~') {
            html += applyStyles('~');
            i++;
        }
    } 

    return html;
}


/**
 * Adds a message to the chat log.
 * @param {string} message The text content of the message.
 * @param {string} [type='system-message'] CSS class for message styling (e.g., 'player-say', 'npc-say').
 * @param {boolean} [parseColors=false] If true, parse M59-style color codes (~b, ~I, etc.). If false, sanitize HTML.
 */
export function addChatMessage(message, type = 'system-message', parseColors = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', type);

    if (parseColors) {
        messageElement.innerHTML = parseColoredText(message);
    } else {
        const safeMessage = message
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        messageElement.innerHTML = safeMessage;
    }

    chatLog.appendChild(messageElement);
    chatLog.scrollTop = chatLog.scrollHeight; 
}


// --- NPC Logic ---
function registerNPC(npcId, name, description, startingRoomId, dialogueStyle, isBanker = false) {
    const room = gameState.rooms[startingRoomId];
    if (!room) {
        console.error(`Cannot add NPC ${npcId}: Room ${startingRoomId} not found.`);
        return;
    }

    gameState.npcs[npcId] = {
        id: npcId,
        name: name,
        description: description,
        currentRoomId: startingRoomId,
        dialogueStyle: dialogueStyle,
        mesh: null, 
        isBanker: isBanker,
        balance: isBanker ? 1000 : 0,
    };
    gameState.conversationHistory[npcId] = [];
    room.npcs.push(npcId);

    if (gameState.currentRoom && gameState.currentRoom.id === startingRoomId) {
        addNPCToScene(gameState.npcs[npcId]);
    }
}

async function getNPCResponse(npc, playerMessage) {
    if (!npc) return null;

    addChatMessage(`You say to ${npc.name}, "${playerMessage}"`, 'player-say'); 

    gameState.conversationHistory[npc.id].push({ role: "user", content: playerMessage });
    gameState.conversationHistory[npc.id] = gameState.conversationHistory[npc.id].slice(-12); 

    try {
        addChatMessage(`${npc.name} is thinking...`, 'system-message'); 

        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are ${npc.name}, a character in a fantasy MUD game reminiscent of Meridian 59. Your personality is: ${npc.dialogueStyle}. The player (${gameState.player.name}) is talking to you in the location: ${gameState.currentRoom.description}. Keep responses concise, in character, and suitable for a MUD chat interface. Avoid conversational fillers unless it fits the character. You can respond to greetings, questions, and basic statements.`
                },
                ...gameState.conversationHistory[npc.id] 
            ],
        });

        let npcResponse = completion.content;

        npcResponse = npcResponse.replace(/^"|"$/g, ''); 

        const thinkingMsg = Array.from(chatLog.children).find(el => el.textContent.includes('is thinking...'));
        if (thinkingMsg) thinkingMsg.remove();

        addChatMessage(`${npc.name} says, "${npcResponse}"`, 'npc-say', true);

        gameState.conversationHistory[npc.id].push({ role: "assistant", content: npcResponse });

        return npcResponse; 

    } catch (error) {
        console.error("LLM Chat Error:", error);
        const thinkingMsg = Array.from(chatLog.children).find(el => el.textContent.includes('is thinking...'));
        if (thinkingMsg) thinkingMsg.remove();
        addChatMessage(`(${npc.name} seems unresponsive.)`, 'system-message');
        return null;
    }
}

// --- Room Logic ---
function registerRoom(roomId, description, exits) {
    gameState.rooms[roomId] = {
        id: roomId,
        description: description,
        exits: exits,
        npcs: [],
        items: [],
        mesh: null, 
        isGenerated: false,
        isGenerating: false,
        objects: [], 
    };
}

async function changeRoom(direction) {
    if (!gameState.currentRoom) {
        addChatMessage("You aren't anywhere specific!", 'error-message');
        return;
    }
    const targetRoomId = gameState.currentRoom.exits[direction.toLowerCase()];
    if (!targetRoomId) {
        addChatMessage("You can't go that way.", 'error-message');
        return;
    }

    if (!gameState.rooms[targetRoomId]) {
        addChatMessage(`Error: Room "${targetRoomId}" definition not found.`, 'error-message');
        return;
    }

    const previousRoom = gameState.currentRoom;
    const targetRoom = gameState.rooms[targetRoomId];

    previousRoom.npcs.forEach(npcId => removeNPCFromScene(gameState.npcs[npcId]));

    gameState.currentRoom = targetRoom;
    gameState.player.position = { x: 0, y: 1, z: 5 }; 

    await ensureRoomIsGenerated(targetRoomId);

    displayCurrentRoomInfo();

    targetRoom.npcs.forEach(npcId => addNPCToScene(gameState.npcs[npcId]));

    gameState.interactingNPC = null;
}

function displayCurrentRoomInfo() {
    const room = gameState.currentRoom;
    if (!room) return;

    addChatMessage(`[${room.id}]`, 'look-description');
    addChatMessage(room.description, 'look-description');

    let exits = Object.keys(room.exits);
    if (exits.length > 0) {
        addChatMessage(`Exits: ${exits.join(', ')}`, 'look-exits');
    } else {
        addChatMessage(`There are no obvious exits.`, 'look-exits');
    }

    if (room.npcs.length > 0) {
        const npcDescriptions = room.npcs.map(id => {
            const npc = gameState.npcs[id];
            return `${npc.name} (${npc.description})`;
        }).join('\n');
        addChatMessage(`You see:\n${npcDescriptions}`, 'look-npcs');
    }

    if (room.items.length > 0) {
        addChatMessage(`On the ground: ${room.items.join(', ')}`, 'look-items');
    }
}

// --- Command Processing ---
function findNPCInCurrentRoomByName(npcName) {
    if (!gameState.currentRoom) return null;
    const lowerCaseName = npcName.toLowerCase();
    const npcId = gameState.currentRoom.npcs.find(id => gameState.npcs[id]?.name.toLowerCase() === lowerCaseName);
    return npcId ? gameState.npcs[npcId] : null;
}

async function processCommand(command) {
    const parts = command.trim().split(' ');
    const action = parts[0]?.toLowerCase();
    const arg1 = parts[1];
    const arg2 = parts[2];
    const message = command.substring(command.indexOf(' ') + 1).trim(); 
    const messageWithTarget = parts.slice(2).join(' '); 

    if (!action) return; 

    addChatMessage(`> ${command}`, 'system-message'); 

    switch (action) {
        case 'n': case 'north': await changeRoom('north'); break;
        case 's': case 'south': await changeRoom('south'); break;
        case 'e': case 'east': await changeRoom('east'); break;
        case 'w': case 'west': await changeRoom('west'); break;
        case 'u': case 'up': await changeRoom('up'); break;
        case 'd': case 'down': await changeRoom('down'); break;

        case 'say':
        case 's':
            if (!message) { addChatMessage("Say what?", 'error-message'); break; }
            addChatMessage(`${gameState.player.name} says, "${message}"`, 'player-say', true); 
            if (gameState.interactingNPC) {
                await getNPCResponse(gameState.interactingNPC, message);
            }
            break;

        case 'emote':
        case 'e':
             if (!message) { addChatMessage("Emote what?", 'error-message'); break; }
             addChatMessage(`${gameState.player.name} ${message}`, 'player-emote', true); 
             break;

        case 'yell':
        case 'y':
            if (!message) { addChatMessage("Yell what?", 'error-message'); break; }
            addChatMessage(`${gameState.player.name} yells, "${message}"`, 'player-yell', true); 
            break;

        case 'broadcast':
        case 'b':
            if (!message) { addChatMessage("Broadcast what?", 'error-message'); break; }
            addChatMessage(`${gameState.player.name} broadcasts, "${message}"`, 'player-broadcast', true); 
            break;

        case 'tell':
        case 't':
            if (!arg1) { addChatMessage("Tell who?", 'error-message'); break; }
            if (!messageWithTarget) { addChatMessage("Tell them what?", 'error-message'); break; }
            const targetNpcTell = findNPCInCurrentRoomByName(arg1);
            if (targetNpcTell) {
                 addChatMessage(`You tell ${targetNpcTell.name}, "${messageWithTarget}"`, 'player-tell-sent', true); 
                 gameState.interactingNPC = targetNpcTell; 
                 await getNPCResponse(targetNpcTell, messageWithTarget);
            } else {
                 addChatMessage(`You don't see anyone named "${arg1}" here.`, 'error-message');
            }
            break;

        case 'look':
        case 'l':
             if (!arg1) {
                displayCurrentRoomInfo();
             } else {
                const targetLook = findNPCInCurrentRoomByName(arg1); 
                if (targetLook) {
                    addChatMessage(targetLook.description, 'look-description');
                } else {
                    addChatMessage(`You don't see "${arg1}" here.`, 'error-message');
                }
             }
             break;

        case 'talk': 
             if (!arg1) { addChatMessage("Talk to who?", 'error-message'); break; }
             const targetTalk = findNPCInCurrentRoomByName(arg1);
             if (targetTalk) {
                 addChatMessage(`You start talking to ${targetTalk.name}.`, 'system-message');
                 gameState.interactingNPC = targetTalk;
             } else {
                 addChatMessage(`You don't see anyone named "${arg1}" here.`, 'error-message');
             }
             break;

        case 'stop': 
             if (gameState.interactingNPC) {
                 addChatMessage(`You stop talking to ${gameState.interactingNPC.name}.`, 'system-message');
                 gameState.interactingNPC = null;
             } else {
                 addChatMessage(`You weren't talking to anyone.`, 'system-message');
             }
             break;

        case 'deposit':
            if (!gameState.interactingNPC || !gameState.interactingNPC.isBanker) {
                addChatMessage("You need to talk to a banker first.", 'error-message'); break;
            }
            const depositAmount = parseInt(arg1, 10);
            if (isNaN(depositAmount) || depositAmount <= 0) {
                addChatMessage("Deposit how much?", 'error-message'); break;
            }
            if (gameState.player.balance < depositAmount) {
                addChatMessage("You don't have that much money.", 'error-message'); break;
            }
            gameState.player.balance -= depositAmount;
            gameState.interactingNPC.balance += depositAmount; 
            addChatMessage(`You deposit ${depositAmount} shillings. Your balance: ${gameState.player.balance}.`, 'info-message');
            addChatMessage(`${gameState.interactingNPC.name} nods, "Deposited. Thank you for your custom."`, 'npc-say');
            break;

        case 'withdraw':
            if (!gameState.interactingNPC || !gameState.interactingNPC.isBanker) {
                addChatMessage("You need to talk to a banker first.", 'error-message'); break;
            }
            const withdrawAmount = parseInt(arg1, 10);
            if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                addChatMessage("Withdraw how much?", 'error-message'); break;
            }
            if (gameState.interactingNPC.balance < withdrawAmount) {
                addChatMessage(`${gameState.interactingNPC.name} says, "I'm sorry, we don't have enough funds for that withdrawal currently,"`, 'npc-say'); break;
            }
            gameState.interactingNPC.balance -= withdrawAmount; 
            gameState.player.balance += withdrawAmount;
            addChatMessage(`You withdraw ${withdrawAmount} shillings. Your balance: ${gameState.player.balance}.`, 'info-message');
            addChatMessage(`${gameState.interactingNPC.name} hands you the money. "Here you are."`, 'npc-say');
            break;

        case 'balance':
            if (!gameState.interactingNPC || !gameState.interactingNPC.isBanker) {
                addChatMessage("You need to talk to a banker first.", 'error-message'); break;
            }
            addChatMessage(`${gameState.interactingNPC.name} checks the ledger. "Your current account balance is ${gameState.interactingNPC.balance} shillings."`, 'npc-say');
            addChatMessage(`(Your carry balance: ${gameState.player.balance})`, 'info-message'); 
            break;

        case 'help':
             addChatMessage("--- Basic Commands ---", 'info-message');
             addChatMessage("Movement: n, s, e, w, u, d (or north, south, etc.)", 'info-message');
             addChatMessage("Communication: say <msg>, emote <action>, yell <msg>, broadcast <msg>, tell <npc> <msg>", 'info-message');
             addChatMessage("Interaction: look [target], talk <npc>, stop", 'info-message');
             addChatMessage("Banking (talk to banker first): deposit <amt>, withdraw <amt>, balance", 'info-message');
             addChatMessage("Other: help", 'info-message');
             addChatMessage("Color Codes: ~n(reset) ~I(italic) ~U(underline) ~B(bold) ~b(blue) ~g(green) ~r(red) ~k(black)", 'info-message');
             break;

        default:
            addChatMessage(`Unknown command: "${action}"`, 'error-message');
            break;
    }
}

// --- Event Listeners ---
sendButton.addEventListener('click', () => {
    const command = userInput.value;
    if (command.trim()) { 
        processCommand(command); 
        userInput.value = ''; 
    }
});

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click(); 
    }
});

// --- Game Initialization ---
async function initializeGame() {
    addChatMessage("Welcome to Graphical MUD!", 'system-message');
    addChatMessage("Initializing scene...", 'system-message');
    initThreeScene(gameState.player.position); 

    registerRoom('tavern', 'a cozy but dimly lit tavern room. A large fireplace crackles merrily. Wooden tables and chairs are scattered around. The air smells of ale and sawdust.', { north: 'town_square', east: 'kitchen' });
    registerRoom('town_square', 'a bustling town square paved with cobblestones. Merchants hawk their wares from colorful stalls. Guards patrol the perimeter. A fountain bubbles in the center.', { south: 'tavern', west: 'alley', east: 'market_street' });
    registerRoom('alley', 'a narrow, damp alleyway littered with refuse between tall buildings. It smells unpleasant, and shadows cling to the corners.', { east: 'town_square' });
    registerRoom('kitchen', 'a hot, steamy kitchen filled with the sounds of chopping and sizzling. Pots hang from the ceiling, and sacks of flour lean against the wall.', { west: 'tavern' });
    registerRoom('market_street', 'a wide street lined with shops. Signs for a baker, a blacksmith, and an apothecary are visible.', { west: 'town_square', north: 'bank' });
    registerRoom('bank', 'a sturdy stone building with barred windows. Inside, a polished counter separates you from the clerks. It feels secure.', { south: 'market_street' });

    registerNPC('barkeep', 'Barkeep Bill', 'A stout, friendly-looking man with a bushy mustache, wiping down the bar.', 'tavern', 'a friendly, slightly gruff tavern owner. Loves local gossip, knows who comes and goes.');
    registerNPC('cook', 'Cook Peggy', 'A round woman with flour dusting her apron, bustling around the kitchen.', 'kitchen', 'a busy, slightly stressed cook. Doesn\'t like interruptions but might trade food for favors.');
    registerNPC('guard', 'Guard Gregor', 'A tall, stern-faced guard in city watch armor, standing alert.', 'town_square', 'a dutiful, by-the-book town guard. Speaks formally, concerned with law and order.');
    registerNPC('shadyfigure', 'Shady Figure', 'A figure lurking in the shadows of the alley, cloaked and keeping their face hidden.', 'alley', 'a suspicious, tight-lipped individual. Speaks in short, cryptic sentences. Might offer illicit deals.');
    registerNPC('banker', 'Banker Thomas', 'A prim clerk wearing spectacles, sitting behind the counter.', 'bank', 'a polite but formal bank clerk. Focused on money and procedures.', true); 

    addChatMessage("Entering the world...", 'system-message');
    await changeRoom('tavern'); 
    addChatMessage("Type 'help' for a list of commands.", 'info-message');
}

initializeGame();