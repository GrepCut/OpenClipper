use super::WinMlModel;

impl Drop for WinMlModel {
    fn drop(&mut self) {
        self.session.close();
        if let Some(single) = self.single_session.take() {
            let _ = single.Close();
        }
        let _ = self.model.Close();
    }
}
