import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Citations } from './Citations';
import { DataTable } from './DataTable';
import { ImageGallery } from './ImageGallery';
import { Sidebar } from './Sidebar';
import { TimetableView } from './TimetableView';

describe('structured rendering', () => {
  it('renders a sortable HTML table', async () => {
    render(
      <DataTable
        title="Synthetic table"
        columns={['Period', 'Subject']}
        rows={[
          ['2', 'Beta'],
          ['1', 'Alpha'],
        ]}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Period' }));
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toBe('2');
  });

  it('renders timetable rows and an empty verified-cell state', () => {
    const { rerender } = render(
      <TimetableView
        title="Synthetic timetable"
        view="day"
        day="friday"
        verificationStatus="verified"
        entries={[
          {
            dayOfWeek: 'friday',
            periodNumber: 1,
            startTime: '09:00',
            endTime: '09:50',
            subjectName: 'Synthetic Subject',
            faculty: 'Example Faculty',
            room: 'C-101',
            entryType: 'lecture',
            confidence: 1,
          },
        ]}
        citations={[{ id: '1', title: 'Official timetable', url: 'https://www.lbrce.ac.in/cse/csetimetables.php', verificationStatus: 'unverified', sourceType: 'timetable' }]}
      />,
    );
    expect(screen.getByRole('table')).toHaveTextContent('Synthetic Subject');
    expect(screen.getByRole('link', { name: 'Official timetable' })).toHaveAttribute('href', 'https://www.lbrce.ac.in/cse/csetimetables.php');
    rerender(<TimetableView title="Missing cells" view="week" verificationStatus="unverified" entries={[]} citations={[]} />);
    expect(screen.getByText(/have not been verified/)).toBeInTheDocument();
  });

  it('renders image provenance and a broken-image fallback', () => {
    render(
      <ImageGallery
        title="Campus"
        images={[{ id: 'img-1', url: 'https://www.lbrce.ac.in/assets/images/lbrce_logo.jpg', pageUrl: 'https://www.lbrce.ac.in/', title: 'College mark', alt: 'LBRCE mark', caption: 'From the homepage', topic: 'campus' }]}
      />,
    );
    expect(screen.getByText('From the homepage')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Official page' })).toHaveAttribute('href', 'https://www.lbrce.ac.in/');
  });

  it('renders clickable citations', () => {
    render(
      <Citations
        citations={[{ id: 'c', title: 'Courses', url: 'https://www.lbrce.ac.in/admission_pages/courses.php', pageNumber: 1, verificationStatus: 'unverified', sourceType: 'webpage' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', expect.stringContaining('courses.php'));
  });
});

describe('navigation', () => {
  it('shows the mobile navigation after the menu control is used', async () => {
    render(
      <MemoryRouter>
        <Sidebar open={false} onClose={vi.fn()} conversations={[]} onNew={vi.fn()} onSelect={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByText('No conversations yet.')).toBeInTheDocument();
  });
});
