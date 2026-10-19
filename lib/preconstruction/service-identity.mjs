export const normalizedServiceName = value => String(value ?? '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
export const normalizedServiceUnit = value => String(value ?? 'un').toLowerCase().replaceAll('²','2').replaceAll('³','3').replace(/\s+/g,'');
export function compatibleService(item, service) {
  return normalizedServiceName(item.description) === normalizedServiceName(service.description) && normalizedServiceUnit(item.unit) === normalizedServiceUnit(service.unit);
}
