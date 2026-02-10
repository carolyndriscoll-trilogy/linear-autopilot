import { parseTokenUsage } from '../../src/tracking';

describe('Tracking', () => {
  describe('parseTokenUsage', () => {
    it('should parse "Tokens: X input, Y output" format', () => {
      const output = 'Some output\nTokens: 1234 input, 5678 output\nMore output';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 1234, output: 5678 });
    });

    it('should parse case-insensitively', () => {
      const output = 'TOKENS: 100 INPUT, 200 OUTPUT';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 100, output: 200 });
    });

    it('should parse "input_tokens: X, output_tokens: Y" format', () => {
      const output = 'input_tokens: 500, output_tokens: 1000';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 500, output: 1000 });
    });

    it('should parse JSON format with token info', () => {
      const output = '{"input_tokens": 2000, "output_tokens": 3000}';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 2000, output: 3000 });
    });

    it('should parse total tokens and split 50/50', () => {
      const output = 'Total tokens used: 1000';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 500, output: 500 });
    });

    it('should handle odd total tokens (ceil/floor split)', () => {
      const output = 'Total tokens used: 1001';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 500, output: 501 });
    });

    it('should return null when no token info found', () => {
      const output = 'Just some regular output without token info';
      const result = parseTokenUsage(output);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseTokenUsage('');

      expect(result).toBeNull();
    });

    it('should handle multiline output and find tokens', () => {
      const output = `
        Starting task...
        Working on implementation...
        Completed successfully!
        Tokens: 5000 input, 2500 output
        Done.
      `;
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 5000, output: 2500 });
    });

    it('should parse with optional colon after Tokens', () => {
      const output = 'Token 1500 input, 750 output';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 1500, output: 750 });
    });

    it('should handle large token counts', () => {
      const output = 'Tokens: 1000000 input, 500000 output';
      const result = parseTokenUsage(output);

      expect(result).toEqual({ input: 1000000, output: 500000 });
    });
  });
});
