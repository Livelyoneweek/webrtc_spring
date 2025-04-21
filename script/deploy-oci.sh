#!/bin/bash
PROJECT_NAME='webrtc'
SCP_TARGET_HOST='oci'

# 현재 디렉토리를 가져옴
current_path="$(echo $PWD)"

# '/'를 기준으로 경로를 나눔
IFS='/' read -ra ADDR <<< "$current_path"

# 경로의 마지막 요소가 $PROJECT_NAME 를 포함하는지 확인
for i in "${!ADDR[@]}"; do
  if [[ "${ADDR[$i]}" == *$PROJECT_NAME* ]]; then
    # 해당 조건을 만족하는 경우, 이전 요소들과 합쳐서 전체 경로를 재구성
    PROJECT_ROOT=""
    for j in $(seq 0 $i); do
      PROJECT_ROOT+="/${ADDR[$j]}"
    done

    # 맨 앞에 추가된 '/' 제거
    PROJECT_ROOT=${PROJECT_ROOT:1}

    # 변수를 환경변수로 내보냄 (선택사항)
    # export PROJECT_ROOT

    # 찾은 경로 출력 (확인용)
    echo "PROJECT_ROOT is set to: $PROJECT_ROOT"

    break # 루프 종료
  fi
done

"$PROJECT_ROOT"/gradlew clean bootJar -x test -Pprofile=dev;
echo "PACKAGE JAR COMPLETE!!"
echo scp "$PROJECT_ROOT"/build/libs/webrtc-0.0.1-SNAPSHOT.jar "$SCP_TARGET_HOST":/home/ubuntu/webrtc/webrtc.jar
scp "$PROJECT_ROOT"/build/libs/webrtc-0.0.1-SNAPSHOT.jar "$SCP_TARGET_HOST":/home/ubuntu/webrtc/webrtc.jar
echo "SEND JAR COMPLETE!!"
