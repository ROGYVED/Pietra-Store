import { PrismaClient } from '@prisma/client';
import supplierCatalog from './supplier-catalog.json';

const prisma = new PrismaClient();

const slugify = (value: string) => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

async function main() {
  const categories = new Map<string, string>();
  for (const name of ['Calçados', 'Bolsas']) {
    const category = await prisma.category.upsert({
      where: { slug: slugify(name) },
      update: { name, active: true },
      create: { name, slug: slugify(name) },
    });
    categories.set(name, category.id);
  }

  for (const item of supplierCatalog) {
    const categoryId = categories.get(item.category);
    if (!categoryId) throw new Error(`Categoria não configurada: ${item.category}`);

    const productSlug = `fornecedor-${item.supplierId}`;
    const color = item.name.includes(' - ')
      ? item.name.split(' - ').pop()?.trim() || null
      : null;
    const sizes = item.category === 'Bolsas'
      ? [0]
      : Array.from({ length: 12 }, (_, index) => index + 32);
    const product = await prisma.product.upsert({
      where: { slug: productSlug },
      update: {
        name: item.name,
        categoryId,
        color,
        costCents: item.supplierPriceCents,
        priceCents: item.supplierPriceCents * 2,
      },
      create: {
        name: item.name,
        slug: productSlug,
        reference: `FORNECEDOR-${item.supplierId}`,
        description: 'Produto importado do catálogo da fornecedora. Consulte a disponibilidade antes da compra.',
        categoryId,
        color,
        costCents: item.supplierPriceCents,
        priceCents: item.supplierPriceCents * 2,
        status: 'DRAFT',
        images: {
          create: {
            url: item.imageUrl,
            alt: item.name,
            isPrimary: true,
          },
        },
      },
      include: { variants: true, images: true },
    });

    if (product.images.length === 0) {
      await prisma.productImage.create({
        data: { productId: product.id, url: item.imageUrl, alt: item.name, isPrimary: true },
      });
    }

    for (const size of sizes) {
      const variantColor = item.category === 'Bolsas' ? null : color;
      const exists = product.variants.some(
        (variant) => variant.size === size && variant.color === variantColor,
      );
      if (exists) continue;

      await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `SUP-${item.supplierId}-${size || 'U'}`,
          size,
          color: variantColor,
          stockQuantity: 0,
          active: true,
        },
      });
    }
  }

  console.log(`Catálogo importado: ${supplierCatalog.length} produtos em rascunho, sem estoque presumido.`);
}

main()
  .catch((error) => {
    console.error('Falha ao importar o catálogo:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
