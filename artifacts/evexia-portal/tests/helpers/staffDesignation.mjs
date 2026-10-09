// Run inside the synthetic authenticated page; uses real catalogue UUIDs.
export async function staffDesignation(page) {
  return page.evaluate(async () => {
    const { listDesignations, createDesignation } = await import('/src/services/serverDesignations.js');
    const { items } = await listDesignations({ query: 'Executive', status: 'active', limit: 100 });
    const saved = items.find((item) => item.name === 'Executive');
    return saved?.id || (await createDesignation({ name: 'Executive', shortName: 'EX', status: 'active' })).id;
  });
}
