import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';

describe('chat submission', () => {
  it('shows an error state when the request fails and keeps the composer usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'The model provider is unavailable', code: 'UNAVAILABLE' } }),
      }),
    );
    render(<ChatPage onConversation={vi.fn()} />);
    expect(screen.getByText('Ask the college assistant')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'What is LBRCE?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('The model provider is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
