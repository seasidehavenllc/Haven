-- Live chat replies: a message can answer another message in the same show.
ALTER TABLE "StreamChatMessage" ADD COLUMN "replyToId" TEXT;
ALTER TABLE "StreamChatMessage" ADD CONSTRAINT "StreamChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "StreamChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
