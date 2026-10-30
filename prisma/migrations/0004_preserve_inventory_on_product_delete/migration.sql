ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_variantId_fkey";

ALTER TABLE "InventoryMovement" ALTER COLUMN "variantId" DROP NOT NULL;

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
