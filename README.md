# Sequence Online (3인 고정 + AI)

웹 브라우저에서 방 코드로 접속해 플레이하는 온라인 Sequence 게임입니다.

## 지원 기능

- 컴퓨터/폰 브라우저 동시 접속
- 3인 게임 고정 (사람 + AI 합계 3명)
- AI 플레이어 참가 지원
  - 사람 1명이면 AI 3명까지 자동 구성 가능
- 방 코드 기반 실시간 멀티플레이 (Socket.IO)

## 로컬 실행

```bash
npm install
npm start
```

실행 후 `http://localhost:3000` 접속

## Render 배포 (무료 플랜 가능)

1. GitHub에 이 프로젝트 푸시
2. [Render Dashboard](https://dashboard.render.com/)에서 New + > Blueprint 선택
3. 저장소 선택 후 배포
4. 배포 완료 후 제공되는 URL로 접속 (예: `https://sequence-online.onrender.com`)

`render.yaml`이 포함되어 있어 기본 설정이 자동 적용됩니다.
