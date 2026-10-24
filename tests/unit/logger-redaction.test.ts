import { describe, expect, it } from 'vitest';
import { serializeError } from '../../src/lib/logger';

describe('serializeError', () => {
  it('drops request config carried by library errors so bearer tokens never reach the logs', () => {
    const error = Object.assign(new Error('Request failed with status code 401'), {
      code: 401,
      config: { headers: { Authorization: 'Bearer ya29.SECRET' } },
      response: { config: { headers: { Authorization: 'Bearer ya29.SECRET' } } },
    });

    const serialized = serializeError(error);

    expect(JSON.stringify(serialized)).not.toContain('ya29.SECRET');
    expect(serialized).toMatchObject({ message: 'Request failed with status code 401', code: 401 });
  });
});
