const prisma = {
  generation: {
    create: async (_input: unknown) => undefined,
  },
};

export async function saveGeneration(script: unknown) {
  return prisma.generation.create({ data: { script } });
}
