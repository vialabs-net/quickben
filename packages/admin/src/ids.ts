/** Id of the main control of a field. Labels, hints and errors derive their ids from it. */
export function controlId(name: string): string {
  return `qb-field-${name}`;
}
