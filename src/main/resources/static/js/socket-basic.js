let stompClient = null;
let peerConnection = null;
let localStream = null;
let username = ""; // 전역 변수

const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" } // 기본 STUN 서버
    ]
};

function connect() {
    username = document.getElementById("username").value.trim();
    if (!username) {
        alert("닉네임을 입력해주세요");
        return;
    }

    const socket = new SockJS("/ws");
    stompClient = Stomp.over(socket);

    stompClient.connect({}, function () {
        log(`✅ ${username} WebSocket 연결됨`);

        stompClient.subscribe('/topic/message', function (message) {
            const msg = JSON.parse(message.body);
            log("📥 메시지 수신: " + JSON.stringify(msg));
            handleSignal(msg); // WebRTC용 메시지 핸들링
        });

        startWebRTC(); // 웹캠 or 화면 공유 등 연결 시작
    });
}

async function startWebRTC() {

    // webrtc 에서 서로 영상,음성 등 데이터 공유하는 핵심 주체
    peerConnection = new RTCPeerConnection(configuration);

    // ICE candidate 발생 시 서버로 전송
    // WebRTC 연결 과정에서 브라우저가 ICE candidate를 찾을 때마다 자동으로 호출되는 이벤트 리스너
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            // candidate 정보를 signaling 서버를 통해 상대방에게 전송
            sendMessage({
                type: "candidate",
                sender: username,
                roomId: "room1",
                target: "userB",
                data: event.candidate
            });
        }
    };

    // 1. 상대방의 영상/음성 스트림을 수신하면 실행됨
    peerConnection.ontrack = event => {
        log("🎥 상대방 미디어 수신됨");
        // document.querySelector("#remoteVideo").srcObject = event.streams[0];
    };

    // 2. 내 카메라/마이크 스트림을 브라우저에서 요청
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // 내 권한 얻음
    // 3. 내 스트림을 peerConnection에 추가
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream)); // 내 영상/음성 추가

    // document.querySelector("#localVideo").srcObject = localStream;

    // 4. offer 생성 및 전송
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendMessage({
        type: "offer",
        sender: "userA",
        roomId: "room1",
        target: "userB",
        data: offer
    });
}

// 시그널링 서버로부터 받은 메시지를 처리하는 핸들러 함수
// type(offer, answer, candidate)에 따라 알맞은 WebRTC 흐름으로 분기 처리
function handleSignal(msg) {
    switch (msg.type) {
        case "offer":
            // 상대방이 보낸 offer 수신 → PeerConnection을 만들고 answer 생성
            onOffer(msg);
            break;
        case "answer":
            // 상대방이 보낸 answer 수신 → 내 PeerConnection에 등록하여 연결 완료
            onAnswer(msg);
            break;
        case "candidate":
            // 상대방이 보낸 ICE candidate 수신 → 내 PeerConnection에 추가
            onCandidate(msg);
            break;
    }
}

async function onOffer(msg) {
    // 1. peerConnection 생성
    peerConnection = new RTCPeerConnection(configuration);

    // 2. 내 ICE candidate 준비
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({
                type: "candidate",
                sender: "userB",
                roomId: "room1",
                target: "userA",
                data: event.candidate
            });
        }
    };

    // 3. 내 스트림(카메라/마이크) 설정
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // 4. 상대방의 offer를 내 peerConnection에 등록 (내가 받은 걸 기억)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));

    // 5. answer 생성 + 등록 + 상대방에게 전송
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendMessage({
        type: "answer",
        sender: "userB",
        roomId: "room1",
        target: "userA",
        data: answer
    });
}

async function onAnswer(msg) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));
}

async function onCandidate(msg) {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data));
    } catch (e) {
        log("❌ ICE candidate 추가 실패: " + e);
    }
}

function sendMessage(payload) {
    stompClient.send("/app/message", {}, JSON.stringify(payload));
}

function log(msg) {
    const logDiv = document.getElementById("log");
    logDiv.innerHTML += `<div>${msg}</div>`;
}
window.connect = connect;