import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/components';

describe('Button（Style 7.1）', () => {
  test('primary 可點擊', async () => {
    const onPress = jest.fn();
    await render(<Button label="Clock In" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('disabled 保留原因文字且不可點擊', async () => {
    const onPress = jest.fn();
    await render(<Button label="Clock In" disabled disabledReason="2,340 steps to go" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText('2,340 steps to go')).toBeTruthy();
  });

  test('loading 顯示動詞並保持 busy', async () => {
    await render(<Button label="Submit" loading loadingLabel="Submitting…" />);
    expect(screen.getByText('Submitting…')).toBeTruthy();
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  /** 2026-10-04 實機：按鈕高度固定，半寬的「Health Connect settings」換成三行，第三行被切掉 */
  test('文字固定單行，放不下就縮字，不換行被切', async () => {
    await render(<Button label="Health Connect settings" variant="secondary" />);
    const label = screen.getByText('Health Connect settings');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
  });
});
