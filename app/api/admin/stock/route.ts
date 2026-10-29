import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAdminSession } from '@/lib/admin-auth';
const schema=z.object({variantId:z.string().min(1),quantity:z.number().int().nonnegative(),note:z.string().trim().min(3).max(500)});
export async function POST(request:Request) {
  const admin=await getAdminSession(); if(!admin) return NextResponse.json({error:'Acesso administrativo necessário.'},{status:401});
  const parsed=schema.safeParse(await request.json().catch(()=>null)); if(!parsed.success) return NextResponse.json({error:'Dados de estoque inválidos.'},{status:400});
  try {
    const result=await prisma.$transaction(async tx=>{
      const variant=await tx.productVariant.findUnique({where:{id:parsed.data.variantId}}); if(!variant) throw new Error('NOT_FOUND');
      if(parsed.data.quantity<variant.reservedQuantity) throw new Error('BELOW_RESERVED');
      const delta=parsed.data.quantity-variant.stockQuantity;
      const changed=await tx.productVariant.updateMany({
        where:{id:variant.id,stockQuantity:variant.stockQuantity,reservedQuantity:{lte:parsed.data.quantity}},
        data:{stockQuantity:parsed.data.quantity},
      });
      if(!changed.count) throw new Error('STOCK_CHANGED');
      const updated=await tx.productVariant.findUniqueOrThrow({where:{id:variant.id}});
      await tx.inventoryMovement.create({data:{variantId:variant.id,type:'ADJUSTMENT',quantity:delta,note:parsed.data.note}});
      await tx.auditLog.create({data:{action:'STOCK_ADJUSTMENT',entity:'ProductVariant',entityId:variant.id,metadata:{from:variant.stockQuantity,to:parsed.data.quantity,adminEmail:admin.email,note:parsed.data.note}}});
      return updated;
    });
    return NextResponse.json({variant:result});
  } catch(e) { const msg=e instanceof Error?e.message:''; return NextResponse.json({error:msg==='NOT_FOUND'?'Variante não encontrada.':msg==='BELOW_RESERVED'?'O estoque não pode ficar abaixo das unidades reservadas.':msg==='STOCK_CHANGED'?'O estoque mudou em outra operação. Atualize e tente novamente.':'Não foi possível ajustar o estoque.'},{status:msg==='NOT_FOUND'?404:msg==='STOCK_CHANGED'?409:400}); }
}
