let stompClient = null;
let localStream = null;
let peerConnections = {}; // 유저별 peer 연결
let username = "";

const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

window.connect = connect;

function connect() {
    username = document.getElementById("username").value.trim();
    if (!username) {
        alert("닉네임을 입력해주세요");
        return;
    }

    const socket = new SockJS("/ws");
    stompClient = Stomp.over(socket);

    stompClient.connect({}, () => {
        log(`✅ ${username} WebSocket 연결됨`);

        stompClient.subscribe("/topic/message", (message) => {
            const msg = JSON.parse(message.body);
            if (msg.sender === username) return; // 내 메시지는 무시
            handleSignal(msg);
        });

        startMedia();
    });
}

async function startMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("localVideo").srcObject = localStream;

    // 방에 입장 시 join 메시지 전송
    sendMessage({ type: "join", sender: username });
}

function handleSignal(msg) {
    switch (msg.type) {
        case "join":
            createOfferTo(msg.sender); break;
        case "offer":
            receiveOffer(msg); break;
        case "answer":
            receiveAnswer(msg); break;
        case "candidate":
            receiveCandidate(msg); break;
    }
}

function createPeerConnection(target) {
    if (peerConnections[target]) return;

    const pc = new RTCPeerConnection(configuration);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({
                type: "candidate",
                sender: username,
                target,
                data: event.candidate
            });
        }
    };

    pc.ontrack = (event) => {
        log(`🎥 ${target}의 영상 수신됨`);
        setRemoteStream(target, event.streams[0]);
    };

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    peerConnections[target] = pc;
}

async function createOfferTo(target) {
    createPeerConnection(target);

    const pc = peerConnections[target];
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendMessage({
        type: "offer",
        sender: username,
        target,
        data: offer
    });
}

async function receiveOffer(msg) {
    createPeerConnection(msg.sender);

    const pc = peerConnections[msg.sender];
    await pc.setRemoteDescription(new RTCSessionDescription(msg.data));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendMessage({
        type: "answer",
        sender: username,
        target: msg.sender,
        data: answer
    });
}

async function receiveAnswer(msg) {
    const pc = peerConnections[msg.sender];
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
}

async function receiveCandidate(msg) {
    const pc = peerConnections[msg.sender];
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data));
    } catch (e) {
        log("❌ ICE candidate 추가 실패: " + e);
    }
}

function sendMessage(payload) {
    stompClient.send("/app/message", {}, JSON.stringify(payload));
}

function setRemoteStream(id, stream) {
    const container = document.getElementById("remoteVideos");
    if (!document.getElementById(id)) {
        const video = document.createElement("video");
        video.id = id;
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = "300px";
        video.style.border = "1px solid #ccc";
        container.appendChild(video);
    }
    document.getElementById(id).srcObject = stream;
}

function log(msg) {
    const logDiv = document.getElementById("log");
    logDiv.innerHTML += `<div>${msg}</div>`;
}