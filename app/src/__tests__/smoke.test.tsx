import { render, screen, waitFor } from '@testing-library/react-native';

import App from '../../App';

// RNTL 14：render 為 async。預設 bootstrap 無 session → 300ms 內完成，跳過 loading 直接進 Landing（Style 8.2／9.3）
test('App 冷啟動後進入 Landing', async () => {
  await render(<App />);
  await waitFor(() => expect(screen.getByTestId('landing-screen')).toBeTruthy());
  expect(screen.getByText('Start your adventure')).toBeTruthy();
  expect(screen.getByText('DEVNET')).toBeTruthy();
});
