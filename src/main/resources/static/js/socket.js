let stompClient = null;
let localStream = null;
let peerConnections = {}; // 유저별 peer 연결
let username = "";
const candidateQueue = {}; // sender → candidate 배열

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

    // ✅ 입장 알림
    sendMessage({ type: "join", sender: username });
}

function handleSignal(msg) {
    switch (msg.type) {
        case "new_user":
            handleNewUser(msg.data); // 새로운 유저 처리
            break;
        case "user_left":
            handleUserLeft(msg.data); // 유저 퇴장 처리
            break;
        case "offer":
            receiveOffer(msg);
            break;
        case "answer":
            receiveAnswer(msg);
            break;
        case "candidate":
            receiveCandidate(msg);
            break;
        case "join":
            break; // 무시
    }
}

function handleNewUser(data = {}) {
    const { users = [], offers = [] } = data;

    // 새로운 연결만 설정
    const myTargets = offers
        .filter(([from, to]) => from === username)
        .map(([_, to]) => to);

    myTargets.forEach(target => createOfferTo(target));
}

function handleUserLeft(data = {}) {
    const { users = [] } = data;

    // 연결되지 않은 유저의 peerConnections 정리
    Object.keys(peerConnections).forEach(user => {
        if (!users.includes(user)) {
            try {
                peerConnections[user]?.close();
                delete peerConnections[user];
                const videoEl = document.getElementById(`remote-${user}`);
                if (videoEl) videoEl.remove();
                log(`🧹 ${user} 연결 정리`);
            } catch (e) {}
        }
    });
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

    // pc.ontrack = (event) => {
    //     log(`🎥 ${target}의 영상 수신됨`);
    //     setRemoteStream(target, event.streams[0]);
    // };
    pc.ontrack = (event) => {
        const id = target;
        const videoId = `remote-${id}`;
        const videoEl = document.getElementById(videoId);

        if (videoEl && videoEl.srcObject === event.streams[0]) {
            return; // 같은 스트림이면 무시
        }

        log(`🎥 ${id}의 영상 수신됨`);
        setRemoteStream(id, event.streams[0]);
    };

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    peerConnections[target] = pc;
}

function createOfferTo(target) {
    if (peerConnections[target]) {
        const pc = peerConnections[target];
        if (pc.signalingState === "stable") {
            log(`⚠️ 이미 ${target}와 안정적인 연결 존재`);
            return;
        }
        pc.close();
        delete peerConnections[target];
        log(`🧹 ${target} 기존 연결 정리`);
    }

    createPeerConnection(target);
    const pc = peerConnections[target];
    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            sendMessage({
                type: "offer",
                sender: username,
                target,
                data: pc.localDescription
            });
        })
        .catch(e => log(`❌ Offer 생성 실패: ${e.message}`));
}

async function receiveOffer(msg) {
    createPeerConnection(msg.sender);
    const pc = peerConnections[msg.sender];

    await pc.setRemoteDescription(new RTCSessionDescription(msg.data));

    // 💡 candidate 큐 처리
    if (candidateQueue[msg.sender]) {
        for (const cand of candidateQueue[msg.sender]) {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
        candidateQueue[msg.sender] = [];
    }

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
    const sender = msg.sender;
    const pc = peerConnections[sender];
    if (!pc) {
        log(`⚠️ ${sender}에 대한 peerConnection 없음`);
        return;
    }

    if (pc.signalingState !== "have-local-offer") {
        log(`⛔ ${sender}와의 연결 상태가 have-local-offer가 아님: ${pc.signalingState}`);
        return;
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        log(`✅ answer 설정됨: ${sender}`);

        if (candidateQueue[sender]) {
            for (const cand of candidateQueue[sender]) {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
            candidateQueue[sender] = [];
        }
    } catch (e) {
        log(`⚠️ answer 설정 중 에러: ${e.message}`);
    }
}


async function receiveCandidate(msg) {
    const sender = msg.sender;
    const pc = peerConnections[sender];

    if (!pc) {
        log(`⚠️ ${sender}에 대한 peerConnection 없음`);
        return;
    }

    if (!pc.remoteDescription || pc.remoteDescription.type === "") {
        if (!candidateQueue[sender]) candidateQueue[sender] = [];
        if (candidateQueue[sender].length < 50) {
            candidateQueue[sender].push(msg.data);
            log(`📥 candidate 대기열 저장: ${sender}, 큐 크기: ${candidateQueue[sender].length}`);
        } else {
            log(`⚠️ ${sender}의 candidate 큐가 가득 찼습니다`);
        }
        return;
    }

    try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data));
        log(`✅ ICE candidate 추가됨: ${sender}`);
    } catch (e) {
        log(`❌ ICE candidate 추가 실패: ${e.message}`);
    }
}
function sendMessage(payload) {
    stompClient.send("/app/message", {}, JSON.stringify(payload));
}

function setRemoteStream(id, stream) {
    const videoId = `remote-${id}`;
    const container = document.getElementById("remoteVideos");

    let videoEl = document.getElementById(videoId);
    if (!videoEl) {
        videoEl = document.createElement("video");
        videoEl.id = videoId;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.style.width = "300px";
        videoEl.style.border = "1px solid #ccc";
        container.appendChild(videoEl);
        log(`🖼️ ${id} 비디오 요소 생성`);
    }

    if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
        videoEl.play().catch(e => log(`❌ ${id} 비디오 재생 실패: ${e.message}`));
        log(`✅ ${id} 스트림 바인딩 완료`);
    }
}

function log(msg) {
    const logDiv = document.getElementById("log");
    logDiv.innerHTML += `<div>${msg}</div>`;
}