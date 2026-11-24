-- Live show hearts, pinned comment, and per-show chat mutes.
ALTER TABLE "Livestream" ADD COLUMN "pinnedMessageId" TEXT;
ALTER TABLE "Livestream" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "StreamMute" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreamMute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StreamMute_streamId_userId_key" ON "StreamMute"("streamId", "userId");
ALTER TABLE "StreamMute" ADD CONSTRAINT "StreamMute_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Livestream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamMute" ADD CONSTRAINT "StreamMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
