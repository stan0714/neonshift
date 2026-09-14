import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/components';

describe('Button（Style 7.1）', () => {
  test('primary 可點擊', async () => {
    const onPress = jest.fn();
    await render(<Button label="Clock In" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('disabled 保留原因文字且不可點擊', async () => {
    const onPress = jest.fn();
    await render(<Button label="Clock In" disabled disabledReason="2,340 steps to go" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText('2,340 steps to go')).toBeTruthy();
  });

  test('loading 顯示動詞並保持 busy', async () => {
    await render(<Button label="Submit" loading loadingLabel="Submitting…" />);
    expect(screen.getByText('Submitting…')).toBeTruthy();
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });
});
