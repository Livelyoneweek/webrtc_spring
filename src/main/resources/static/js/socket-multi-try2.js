let stompClient = null;
let localStream = null;
const peerConnections = {};          // { username: RTCPeerConnection }
const candidateQueue = {};           // { username: [ICECandidateInit, ...] }
let username = "";

const configuration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
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
        // 서버로 join 메시지 전송
        startMedia().then(() => {
            stompClient.send("/app/message", {}, JSON.stringify({
                type: "join",
                sender: username
            }));
        });

        stompClient.subscribe("/topic/message", ({ body }) => {
            const msg = JSON.parse(body);
            if (msg.sender === username) return;  // 내 메시지는 무시
            handleSignal(msg);
        });
    });
}

async function startMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const localVideo = document.getElementById("localVideo");
    localVideo.srcObject = localStream;
}

// Signaling 메시지 분기 처리
function handleSignal(msg) {
    const { type, sender, data } = msg;
    switch (type) {
        case "new_user":
            handleNewUser(data);
            break;
        case "offer":
            handleOffer(sender, data);
            break;
        case "answer":
            handleAnswer(sender, data);
            break;
        case "candidate":
            handleCandidate(sender, data);
            break;
        case "user_left":
            handleUserLeft(data.users);
            break;
        default:
            console.warn("Unknown signal:", msg);
    }
}

// 새 유저 진입 시 offers 리스트를 보고 offer 생성
function handleNewUser({ users, offers }) {
    // 비디오 요소 갱신
    users.forEach(u => {
        if (u === username) return;
        if (!document.getElementById(`remote-${u}`)) {
            createRemoteVideoElement(u);
        }
    });

    // offers: [[existingUser, newUser], ...]
    offers.forEach(([from, to]) => {
        if (from === username) {
            // 내가 offer를 보내야 할 대상
            ensurePeerConnection(to);
            createAndSendOffer(to);
        }
    });
}

// RTCPeerConnection 생성 및 트랙/이벤트 설정
function ensurePeerConnection(remoteUser) {
    if (peerConnections[remoteUser]) return peerConnections[remoteUser];

    const pc = new RTCPeerConnection(configuration);
    peerConnections[remoteUser] = pc;
    candidateQueue[remoteUser] = [];

    // ICE candidate 수집 시 전송
    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            stompClient.send("/app/message", {}, JSON.stringify({
                type: "candidate",
                sender: username,
                target: remoteUser,
                data: candidate
            }));
        }
    };

    // 원격 트랙 수신 시 비디오에 붙이기
    pc.ontrack = (evt) => {
        const remoteVideo = document.getElementById(`remote-${remoteUser}`);
        if (remoteVideo.srcObject !== evt.streams[0]) {
            remoteVideo.srcObject = evt.streams[0];
        }
    };

    // 내 스트림 트랙 추가
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    return pc;
}

// Offer 생성 및 전송
async function createAndSendOffer(remoteUser) {
    const pc = ensurePeerConnection(remoteUser);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    stompClient.send("/app/message", {}, JSON.stringify({
        type: "offer",
        sender: username,
        target: remoteUser,
        data: pc.localDescription
    }));
}

// Offer 수신 처리 → Answer 생성
async function handleOffer(from, description) {
    const pc = ensurePeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(description));
    // queued ICE 후보자 처리
    drainCandidateQueue(from);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    stompClient.send("/app/message", {}, JSON.stringify({
        type: "answer",
        sender: username,
        target: from,
        data: pc.localDescription
    }));
}

// Answer 수신 처리
async function handleAnswer(from, description) {
    const pc = peerConnections[from];
    if (!pc) return console.error("Unmatched answer from", from);
    await pc.setRemoteDescription(new RTCSessionDescription(description));
    drainCandidateQueue(from);
}

// ICE candidate 수신 처리
function handleCandidate(from, candidate) {
    const pc = peerConnections[from];
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    } else {
        // 아직 PeerConnection 준비 전이면 큐에 쌓아두기
        candidateQueue[from].push(candidate);
    }
}

// 큐에 쌓인 ICE 후보자 모두 적용
function drainCandidateQueue(remoteUser) {
    const pc = peerConnections[remoteUser];
    candidateQueue[remoteUser].forEach(c => {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
    });
    candidateQueue[remoteUser] = [];
}

// 유저 퇴장 처리: 비디오 제거, PeerConnection 닫기
function handleUserLeft(activeUsers) {
    Object.keys(peerConnections).forEach(u => {
        if (!activeUsers.includes(u)) {
            const pc = peerConnections[u];
            pc.close();
            delete peerConnections[u];
            delete candidateQueue[u];
            const vid = document.getElementById(`remote-${u}`);
            if (vid) vid.remove();
        }
    });
}

// 원격 비디오 태그 생성
function createRemoteVideoElement(remoteUser) {
    const container = document.getElementById("remoteVideos");
    const vid = document.createElement("video");
    vid.id = `remote-${remoteUser}`;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.style.width = "300px";
    vid.style.border = "1px solid #ccc";
    container.appendChild(vid);
}