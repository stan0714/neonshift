import { useNavigation } from '@react-navigation/native';

import { Button, Placeholder, Screen } from '@/components';

export function ProfileScreen() {
  const navigation = useNavigation();
  return (
    <Screen insideTabs>
      <Placeholder title="Profile" pgItem="PG-A-21" note="錢包、權限、隱私與斷開" />
      {__DEV__ ? <Button label="Health Connect diagnostics" variant="secondary" onPress={() => navigation.navigate('DevHealth')} /> : null}
    </Screen>
  );
}
