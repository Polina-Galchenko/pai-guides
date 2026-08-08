-- Флаг «гайд виден снаружи, без входа». По умолчанию выключен: все уже
-- существующие гайды остаются закрытыми, открывают их поштучно из админки.
ALTER TABLE "Guide" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- Выдача гостю всегда идёт по этой паре: опубликован И открыт
CREATE INDEX "Guide_status_isPublic_idx" ON "Guide"("status", "isPublic");
