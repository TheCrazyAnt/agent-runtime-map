const prisma = {
  document: {
    create: async (_input: unknown) => undefined,
  },
};

export async function saveDocument(document: unknown) {
  return prisma.document.create({ data: { document } });
}
