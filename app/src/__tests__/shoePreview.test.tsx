import { PanResponder } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ShoePreview } from '@/components/ShoePreview';
import { ThemeProvider } from '@/theme';
import { useLocaleStore } from '@/i18n';

beforeEach(() => useLocaleStore.setState({ setting: 'en', locale: 'en' }));

test('rotate in either direction, zoom and reset without automatic motion', async () => {
  await render(<ThemeProvider><ShoePreview level={4} /></ThemeProvider>);
  await fireEvent.press(screen.getByText('Rotate left'));
  expect(screen.getByText('Side view · 330°')).toBeTruthy();
  await fireEvent.press(screen.getByText('Rotate right'));
  expect(screen.getByText('Side view · 0°')).toBeTruthy();
  await fireEvent.press(screen.getByText('Zoom in'));
  expect(screen.getByTestId('shoe-rotation').props.style.transform[1].scale).toBe(1.3);
  await fireEvent.press(screen.getByText('Rotate right'));
  await fireEvent.press(screen.getByText('Reset view'));
  expect(screen.getByText('Side view · 0°')).toBeTruthy();
  expect(screen.getByTestId('shoe-rotation').props.style.transform[1].scale).toBe(1);
});

test('changing the shoe resets inspection and renders the corresponding animal', async () => {
  const result = await render(<ThemeProvider><ShoePreview level={2} /></ThemeProvider>);
  await fireEvent.press(screen.getByText('Rotate right'));
  await result.rerender(<ThemeProvider><ShoePreview level={5} /></ThemeProvider>);
  expect(screen.getByText('Side view · 0°')).toBeTruthy();
  expect(screen.getByTestId('wildlife-pattern-5')).toBeTruthy();
  expect(screen.queryByTestId('wildlife-pattern-2')).toBeNull();
});


test('horizontal drag rotates and holds its angle while vertical scroll stays available', async () => {
  const spy = jest.spyOn(PanResponder, 'create');
  try {
    await render(<ThemeProvider><ShoePreview level={3} /></ThemeProvider>);
    const handlers = spy.mock.calls[0][0];
    const event = {} as any;
    const vertical = { dx: 4, dy: 30, numberActiveTouches: 1 } as any;
    const horizontal = { dx: 50, dy: 2, numberActiveTouches: 1 } as any;
    expect(handlers.onMoveShouldSetPanResponder?.(event, vertical)).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder?.(event, horizontal)).toBe(true);
    await act(() => {
      handlers.onPanResponderGrant?.(event, horizontal);
      handlers.onPanResponderMove?.(event, horizontal);
    });
    expect(screen.getByText('Side view · 40°')).toBeTruthy();
    await fireEvent.press(screen.getByText('Rotate right'));
    expect(screen.getByText('Side view · 70°')).toBeTruthy();
  } finally {
    spy.mockRestore();
  }
});
