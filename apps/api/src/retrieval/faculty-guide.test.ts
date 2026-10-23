import { describe, expect, it } from 'vitest';
import { departmentQuestion, personQuestion, personTokens, planFacultyQuestion, readFacultyStep, shouldContinueFaculty, wantsFullFacultyList } from './faculty-guide.js';

describe('faculty steps', () => {
  it('asks for a department before naming a person', () => {
    expect(planFacultyQuestion('I need details about faculty', {})).toEqual({ action: 'ask-department' });
    expect(personTokens('I need details about faculty')).toEqual([]);
  });

  it('asks which person after a department is known', () => {
    expect(planFacultyQuestion('faculty details in CSE', { department: 'CSE', departmentName: 'Computer Science and Engineering' })).toEqual({
      action: 'ask-person',
      departmentCode: 'CSE',
      departmentName: 'Computer Science and Engineering',
    });
  });

  it('keeps a direct head-of-department question on the list path', () => {
    expect(planFacultyQuestion('Who is the head of the CSE department?', { department: 'CSE', departmentName: 'Computer Science and Engineering' })).toEqual({
      action: 'list',
      departmentCode: 'CSE',
      headsOnly: true,
    });
  });

  it('continues from the previous question', () => {
    const department = readFacultyStep([{ type: 'clarification', question: departmentQuestion(), options: ['Computer Science and Engineering (CSE)'] }]);
    expect(department).toEqual({ kind: 'department' });
    expect(planFacultyQuestion('Computer Science and Engineering (CSE)', {}, department)).toEqual({ action: 'continue-department' });

    const person = readFacultyStep([
      { type: 'clarification', question: personQuestion('Computer Science and Engineering', 'CSE'), options: ['RAO'] },
    ]);
    expect(person?.kind).toBe('person');
    expect(wantsFullFacultyList('Show the full department list')).toBe(true);
  });

  it('does not treat a new question as the next faculty step', () => {
    const department = readFacultyStep([{ type: 'clarification', question: departmentQuestion(), options: [] }]);
    expect(shouldContinueFaculty('What is the examination schedule?', department)).toBe(false);
    expect(shouldContinueFaculty('CSE', department)).toBe(true);
  });

  it('pulls a named person out of a faculty question', () => {
    expect(planFacultyQuestion('faculty details of Srinivasa Rao', { department: 'CSE' }).action).toBe('named');
    expect(personTokens('faculty details of Srinivasa Rao')).toEqual(['srinivasa', 'rao']);
  });
});
