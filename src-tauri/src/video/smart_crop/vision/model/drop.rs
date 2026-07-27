use super::WinMlModel;

impl Drop for WinMlModel {
    fn drop(&mut self) {
        self.batch_context.take();
        self.single_context.take();
        if let Some(session) = self.session.take() {
            session.close();
        }
        if let Some(single) = self.single_session.take() {
            let _ = single.Close();
        }
        if let Some(model) = self.model.take() {
            let _ = model.Close();
        }
    }
}
